/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * User-activity awareness for MCP clients: the sequence-numbered event ledger
 * behind the `[context: ...]` alert lines appended to tool results and the
 * `get-user-context` tool.
 *
 * Each renderer window observes a small, bounded set of workbench events
 * (console executions, execution errors, active editor / selection changes,
 * notebook open/close, foreground session changes) and pushes them to the
 * main-process server, which records them here. The ledger assigns each event
 * a monotonic `seq`, so clients can ask "what happened after seq N". This is
 * deliberately not a general event bus: only the categories above are
 * recorded, and every payload is truncated at record time.
 *
 * Lifetime: the ledger lives on the main-process server object, so `seq` is
 * monotonic across window reloads and across server stop/start within one
 * Positron run. It resets when Positron quits; a `since` from a previous run
 * (ahead of the current seq) is detected and treated as "return everything".
 *
 * Everything in this file is plain data + pure logic (no DOM, no Node), so it
 * is shared by the node server, the renderer observer, and the renderer tool
 * handler, and events cross the ProxyChannel as-is -- keep every field a JSON
 * scalar or plain object.
 */

// A type-only import: positronMcpTools.ts imports this module's constants for
// the get-user-context schema, so a runtime import back would be a cycle.
import type { IMcpCallToolResult } from './positronMcpTools.js';

/** The sections a get-user-context response can carry. */
export type McpUserContextSection = 'session' | 'editor' | 'console' | 'notebooks' | 'errors';

/** All sections, in response order; also the `include` enum in the tool schema. */
export const MCP_USER_CONTEXT_SECTIONS: readonly McpUserContextSection[] = ['session', 'editor', 'console', 'notebooks', 'errors'];

/**
 * Hard cap on each recorded string payload (code, output, traceback). Bounds
 * both the ledger's memory and the worst-case get-user-context response:
 * `maxConsoleEntries` entries of a few capped fields each stays far below the
 * server's 1MB body limit.
 */
export const MAX_CONTEXT_FIELD_LENGTH = 2048;

/** Default and ceiling for the tool's maxConsoleEntries argument. */
export const DEFAULT_MAX_CONSOLE_ENTRIES = 5;
export const MAX_CONSOLE_ENTRIES_LIMIT = 50;

/**
 * One console execution, recorded when it settles (result, error, or idle) so
 * a single event carries the outcome. `executedBy` is a display label ('user',
 * a client's display name, 'assistant'); `causedByMcpSession` is the identity
 * used for filtering: unset means the user (or a non-MCP agent) ran it.
 */
export interface IMcpConsoleExecutionEvent {
	readonly kind: 'console-execution';
	/** The window whose console ran the code. */
	readonly windowId: number;
	/** Epoch milliseconds the execution was submitted. */
	readonly timestamp: number;
	readonly languageId: string;
	/** The submitted code, truncated to {@link MAX_CONTEXT_FIELD_LENGTH}. */
	readonly code: string;
	/** Who ran it, for display: 'user', an MCP client's display name, 'assistant', ... */
	readonly executedBy: string;
	/** The MCP session whose tool call ran the code, when one did. */
	readonly causedByMcpSession?: string;
	/** 'unknown' when the execution never settled (session ended mid-run). */
	readonly status: 'ok' | 'error' | 'unknown';
	/** Accumulated text output, truncated to {@link MAX_CONTEXT_FIELD_LENGTH}. */
	readonly output?: string;
	readonly error?: { readonly name: string; readonly message: string; readonly traceback: readonly string[] };
}

/**
 * A content-free workbench change marker. These carry no payload on purpose:
 * they exist so alerts can say "active editor changed" and so state-like
 * get-user-context sections can answer "did this change since seq N" -- the
 * section content itself is always a live snapshot from the renderer.
 */
export interface IMcpWorkbenchChangeEvent {
	readonly kind: 'editor-change' | 'notebook-open' | 'notebook-close' | 'session-change';
	readonly windowId: number;
	readonly timestamp: number;
	/** editor-change only: whether the editor itself or just the selection moved. */
	readonly change?: 'editor' | 'selection';
	/** The MCP session whose tool call caused the change, when one did. */
	readonly causedByMcpSession?: string;
}

/** An event as pushed by a renderer window, before the ledger assigns a seq. */
export type McpContextEventInput = IMcpConsoleExecutionEvent | IMcpWorkbenchChangeEvent;

/** A recorded event. */
export type McpContextEvent = McpContextEventInput & { readonly seq: number };

/** A get-user-context query, as sent by the renderer tool handler. */
export interface IMcpUserContextQuery {
	/** The requesting MCP session; scopes attribution and the pinned window. */
	readonly mcpSessionId: string;
	/** Return only events after this seq; state sections only if changed after it. */
	readonly since?: number;
	readonly maxConsoleEntries?: number;
}

/** The ledger's answer to a query; the renderer composes the tool result from it. */
export interface IMcpUserContextData {
	/** The current high-water seq. */
	readonly seq: number;
	/** `since` was ahead of the current seq (a stale value from a previous run). */
	readonly sinceAheadOfSeq: boolean;
	/** Events after `since` were already evicted; event sections may be incomplete. */
	readonly eventsEvicted: boolean;
	/** Console executions visible to the requester, oldest first, capped. */
	readonly consoleEvents: readonly (IMcpConsoleExecutionEvent & { readonly seq: number })[];
	/** The error subset of the above, capped independently so old errors survive. */
	readonly errorEvents: readonly (IMcpConsoleExecutionEvent & { readonly seq: number })[];
	/** Whether each state-like section changed after `since` (true when no since). */
	readonly changed: { readonly session: boolean; readonly editor: boolean; readonly notebooks: boolean };
}

/** Retention: events kept in memory. Oldest are dropped first. */
const MAX_EVENTS = 300;

/** Retention: per-client alert cursors kept (LRU) across session churn. */
const MAX_CURSORS = 200;

function truncateField(text: string, marker: string): string {
	return text.length > MAX_CONTEXT_FIELD_LENGTH ? text.slice(0, MAX_CONTEXT_FIELD_LENGTH) + marker : text;
}

/** Truncate a console event's free-text payloads at record time. */
function truncateConsoleEvent(event: IMcpConsoleExecutionEvent): IMcpConsoleExecutionEvent {
	let error = event.error;
	if (error) {
		// Keep whole traceback lines up to the shared budget so source locations
		// survive; the line that exceeds it is cut and the rest are dropped.
		const traceback: string[] = [];
		let truncated = false;
		let budget = MAX_CONTEXT_FIELD_LENGTH;
		for (const line of error.traceback) {
			if (line.length > budget) {
				if (budget > 0) {
					traceback.push(line.slice(0, budget));
				}
				truncated = true;
				break;
			}
			traceback.push(line);
			budget -= line.length;
		}
		if (truncated) {
			traceback.push('[traceback truncated]');
		}
		error = {
			name: error.name,
			message: truncateField(error.message, '\n[message truncated]'),
			traceback,
		};
	}
	return {
		...event,
		code: truncateField(event.code, '\n[code truncated]'),
		output: event.output === undefined ? undefined : truncateField(event.output, '\n[output truncated - use inspect-variable to read large values]'),
		error,
	};
}

function plural(count: number): string {
	return count === 1 ? '' : 's';
}

/**
 * The main-process ledger of recent user activity.
 *
 * Owns three things: the seq counter, the bounded event buffer, and one alert
 * cursor per MCP session (the seq of the newest event that session has been
 * told about). All reads are filtered three ways, each with a distinct rule:
 *
 * - Alerts ({@link consumeAlert}) report only events with no MCP attribution
 *   at all -- the user's (and non-MCP agents') activity. A client is never
 *   alerted about its own tool calls' effects or another client's.
 * - The get-user-context event sections ({@link query}) return the user's
 *   events plus the requester's own, but never another MCP client's
 *   (mirroring the per-client consent scoping model).
 * - The `changed` flags treat any event as a change regardless of who caused
 *   it: state sections describe shared workbench state, not private activity.
 */
export class McpContextLedger {
	private readonly _events: McpContextEvent[] = [];
	private _seq = 0;
	/** Seq of the newest evicted event; queries older than this saw data loss. */
	private _evictedThroughSeq = 0;
	/** Alert cursor per MCP session id, LRU-bounded. */
	private readonly _cursors = new Map<string, number>();

	constructor(private readonly _capacity: number = MAX_EVENTS) { }

	/** The seq of the most recently recorded event (0 before any event). */
	get highWaterSeq(): number {
		return this._seq;
	}

	/** Record one event, assigning it the next seq. Returns the assigned seq. */
	record(input: McpContextEventInput): number {
		let event = input;
		if (event.kind === 'console-execution') {
			event = truncateConsoleEvent(event);
		} else if (event.kind === 'editor-change' && event.change === 'selection') {
			// Coalesce runs of selection-only moves in one window: replace the
			// previous marker rather than letting a browsing user evict every
			// console event from the buffer. The new seq still counts as a change.
			const last = this._events[this._events.length - 1];
			if (last && last.kind === 'editor-change' && last.change === 'selection'
				&& last.windowId === event.windowId && last.causedByMcpSession === event.causedByMcpSession) {
				this._events.pop();
			}
		}
		const seq = ++this._seq;
		this._events.push({ ...event, seq });
		while (this._events.length > this._capacity) {
			this._evictedThroughSeq = this._events[0].seq;
			this._events.shift();
		}
		return seq;
	}

	/**
	 * Ensure a session has an alert cursor, initializing it to the current
	 * high-water seq: a client that just connected (or reconnected with a known
	 * id) is only alerted about activity from that point on. A no-op when the
	 * session already has a cursor, so a resume keeps its place.
	 */
	ensureCursor(sessionId: string): void {
		if (!this._cursors.has(sessionId)) {
			this._setCursor(sessionId, this._seq);
		}
	}

	/** Move a session's alert cursor to the current high-water seq. */
	advanceCursor(sessionId: string): void {
		this._setCursor(sessionId, this._seq);
	}

	/**
	 * The `[context: ...]` alert line for a session, or undefined when there is
	 * nothing to report. Consuming: the session's cursor advances to the current
	 * high-water seq either way, so each event is alerted at most once.
	 *
	 * Only events with no MCP attribution are reported (categories and counts
	 * only -- never content), scoped to the session's pinned window. Errors are
	 * flagged distinctly within the execution count.
	 */
	consumeAlert(sessionId: string, windowId: number | undefined): string | undefined {
		const cursor = this._cursors.get(sessionId) ?? this._seq;
		this._setCursor(sessionId, this._seq);
		const events = this._events.filter(event =>
			event.seq > cursor
			&& (windowId === undefined || event.windowId === windowId)
			&& event.causedByMcpSession === undefined);
		if (events.length === 0) {
			return undefined;
		}

		const parts: string[] = [];
		const executions = events.filter(event => event.kind === 'console-execution');
		const errors = executions.filter(event => event.kind === 'console-execution' && event.status === 'error');
		if (executions.length > 0) {
			const errorNote = errors.length > 0 ? ` (${errors.length} error${plural(errors.length)})` : '';
			parts.push(`${executions.length} new console execution${plural(executions.length)}${errorNote}`);
		}
		const editorMoves = events.filter(event => event.kind === 'editor-change');
		if (editorMoves.some(event => event.kind === 'editor-change' && event.change !== 'selection')) {
			parts.push('active editor changed');
		} else if (editorMoves.length > 0) {
			parts.push('selection changed');
		}
		const opened = events.filter(event => event.kind === 'notebook-open').length;
		if (opened > 0) {
			parts.push(`${opened} notebook${plural(opened)} opened`);
		}
		const closed = events.filter(event => event.kind === 'notebook-close').length;
		if (closed > 0) {
			parts.push(`${closed} notebook${plural(closed)} closed`);
		}
		if (events.some(event => event.kind === 'session-change')) {
			parts.push('active session changed');
		}
		if (parts.length === 0) {
			return undefined;
		}
		parts.push(`seq ${this._seq}`);
		return `[context: ${parts.join(' | ')}]`;
	}

	/**
	 * Answer a get-user-context query. `windowId` is the requesting session's
	 * pinned window (resolved by the server); undefined means no window scoping.
	 * Does not touch the alert cursor -- the session advances it separately when
	 * the tool result actually reports events.
	 */
	query(query: IMcpUserContextQuery, windowId: number | undefined): IMcpUserContextData {
		const sinceAheadOfSeq = query.since !== undefined && query.since > this._seq;
		const since = query.since === undefined || sinceAheadOfSeq ? undefined : query.since;
		const maxEntries = Math.max(1, Math.min(query.maxConsoleEntries ?? DEFAULT_MAX_CONSOLE_ENTRIES, MAX_CONSOLE_ENTRIES_LIMIT));

		const visible = this._events.filter(event =>
			(since === undefined || event.seq > since)
			&& (windowId === undefined || event.windowId === windowId));

		const isOwnOrUsers = (event: McpContextEvent) =>
			event.causedByMcpSession === undefined || event.causedByMcpSession === query.mcpSessionId;
		const executions = visible.filter((event): event is IMcpConsoleExecutionEvent & { seq: number } =>
			event.kind === 'console-execution' && isOwnOrUsers(event));

		return {
			seq: this._seq,
			sinceAheadOfSeq,
			eventsEvicted: since !== undefined && since < this._evictedThroughSeq,
			consoleEvents: executions.slice(-maxEntries),
			errorEvents: executions.filter(event => event.status === 'error').slice(-maxEntries),
			changed: {
				session: since === undefined || visible.some(event => event.kind === 'session-change'),
				editor: since === undefined || visible.some(event => event.kind === 'editor-change'),
				notebooks: since === undefined || visible.some(event => event.kind === 'notebook-open' || event.kind === 'notebook-close'),
			},
		};
	}

	/** Set a cursor, refreshing its LRU position and bounding the map. */
	private _setCursor(sessionId: string, seq: number): void {
		this._cursors.delete(sessionId);
		this._cursors.set(sessionId, seq);
		while (this._cursors.size > MAX_CURSORS) {
			const oldest = this._cursors.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this._cursors.delete(oldest);
		}
	}
}

// --- get-user-context response composition -----------------------------------

/** Parsed and validated get-user-context arguments. */
export interface IMcpUserContextArgs {
	readonly include: ReadonlySet<McpUserContextSection>;
	readonly since?: number;
	readonly maxConsoleEntries: number;
}

/**
 * Validate the raw tool arguments. Throws with a message naming the valid
 * values on bad input (the tool service turns thrown errors into tool errors).
 */
export function parseUserContextArgs(args: Record<string, unknown>): IMcpUserContextArgs {
	let include: Set<McpUserContextSection>;
	if (args.include === undefined) {
		include = new Set(MCP_USER_CONTEXT_SECTIONS);
	} else if (Array.isArray(args.include)) {
		include = new Set();
		for (const section of args.include) {
			if (!MCP_USER_CONTEXT_SECTIONS.includes(section as McpUserContextSection)) {
				throw new Error(`Unknown include section ${JSON.stringify(section)}. Valid sections: ${MCP_USER_CONTEXT_SECTIONS.join(', ')}.`);
			}
			include.add(section as McpUserContextSection);
		}
	} else {
		throw new Error(`include must be an array of sections (${MCP_USER_CONTEXT_SECTIONS.join(', ')}).`);
	}

	let since: number | undefined;
	if (args.since !== undefined) {
		if (typeof args.since !== 'number' || !Number.isInteger(args.since) || args.since < 0) {
			throw new Error('since must be a non-negative integer event seq.');
		}
		since = args.since;
	}

	let maxConsoleEntries = DEFAULT_MAX_CONSOLE_ENTRIES;
	if (args.maxConsoleEntries !== undefined) {
		if (typeof args.maxConsoleEntries !== 'number' || !Number.isInteger(args.maxConsoleEntries) || args.maxConsoleEntries < 1) {
			throw new Error('maxConsoleEntries must be a positive integer.');
		}
		maxConsoleEntries = Math.min(args.maxConsoleEntries, MAX_CONSOLE_ENTRIES_LIMIT);
	}

	return { include, since, maxConsoleEntries };
}

/** The active editor as reported in the `editor` section. */
export interface IMcpUserContextEditorState {
	readonly path: string;
	readonly kind: 'text' | 'notebook';
	readonly languageId?: string;
	/** 0-based cursor position (text editors only). */
	readonly cursor?: { readonly line: number; readonly character: number };
	/** Selected text (truncated) and 0-based range, or null when nothing is selected. */
	readonly selection?: {
		readonly text: string;
		readonly range: {
			readonly start: { readonly line: number; readonly character: number };
			readonly end: { readonly line: number; readonly character: number };
		};
	} | null;
}

/**
 * A live snapshot of the state-like sections, gathered by the renderer at
 * call time. `null` means "nothing active" (still reported, so the client can
 * tell "no session" from "section not included").
 */
export interface IMcpUserContextStateSnapshot {
	readonly session: {
		readonly name: string;
		readonly languageId: string;
		readonly languageVersion: string;
		readonly mode: string;
		readonly sessionId: string;
	} | null;
	readonly editor: IMcpUserContextEditorState | null;
	readonly notebooks: readonly { readonly path: string; readonly isActive: boolean }[];
}

/**
 * Compose the get-user-context tool result. Pure: ledger data and the state
 * snapshot come in, one JSON text block comes out. The top-level shape is
 * stable -- always `seq`, plus each included section under its fixed key --
 * and the sizes are bounded by construction (capped entries, capped fields),
 * so no blanket output truncation is applied that could cut the JSON mid-way.
 *
 * Section semantics: event-like sections (`console`, `errors`) are included
 * whenever requested (possibly empty); state-like sections (`session`,
 * `editor`, `notebooks`) are included when requested unless a `since` was
 * given and nothing relevant changed after it.
 */
export function buildUserContextResult(args: IMcpUserContextArgs, data: IMcpUserContextData, snapshot: IMcpUserContextStateSnapshot): IMcpCallToolResult {
	const notes: string[] = [];
	if (data.sinceAheadOfSeq) {
		notes.push(`since=${args.since} is ahead of the current seq ${data.seq} (sequence numbers reset when Positron restarts); returning all sections and all retained events.`);
	}
	if (data.eventsEvicted) {
		notes.push('Some events after since were already dropped from the server\'s bounded event buffer; console/errors may be incomplete.');
	}

	const ignoreSince = args.since === undefined || data.sinceAheadOfSeq;
	const response: Record<string, unknown> = { seq: data.seq };
	if (notes.length > 0) {
		response.note = notes.join(' ');
	}
	if (args.include.has('session') && (ignoreSince || data.changed.session)) {
		response.session = snapshot.session;
	}
	if (args.include.has('editor') && (ignoreSince || data.changed.editor)) {
		response.editor = snapshot.editor;
	}
	if (args.include.has('console')) {
		response.console = data.consoleEvents.map(event => ({
			seq: event.seq,
			time: new Date(event.timestamp).toISOString(),
			by: event.executedBy,
			languageId: event.languageId,
			code: event.code,
			status: event.status,
			...(event.output !== undefined && event.output.length > 0 ? { output: event.output } : {}),
			...(event.error ? { error: { name: event.error.name, message: event.error.message } } : {}),
		}));
	}
	if (args.include.has('notebooks') && (ignoreSince || data.changed.notebooks)) {
		response.notebooks = snapshot.notebooks;
	}
	if (args.include.has('errors')) {
		response.errors = data.errorEvents.map(event => ({
			seq: event.seq,
			time: new Date(event.timestamp).toISOString(),
			by: event.executedBy,
			languageId: event.languageId,
			code: event.code,
			error: event.error ?? { name: 'Error', message: 'unknown error', traceback: [] },
		}));
	}

	const returnedConsoleContent =
		(Array.isArray(response.console) && response.console.length > 0)
		|| (Array.isArray(response.errors) && response.errors.length > 0);

	return {
		content: [{ type: 'text', text: JSON.stringify(response) }],
		auditHint: {
			// Console history is the most sensitive read this server exposes;
			// flag results that carry it so the audit file records the call at
			// full detail regardless of the detail setting.
			returnedConsoleContent: returnedConsoleContent || undefined,
			// When event sections were served, the client is caught up: advance
			// its alert cursor instead of alerting it about what it just read.
			advanceContextCursor: (args.include.has('console') || args.include.has('errors')) || undefined,
		},
	};
}
