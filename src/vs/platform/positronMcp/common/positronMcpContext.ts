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
 * Positron run. The server bases each run's seqs at the run start time, so a
 * `since` from a previous run falls outside the current run's seq range and
 * is detected and treated as "return everything".
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
	/**
	 * The sections the response will include. Drives the returned
	 * {@link IMcpUserContextData.advanceCursor} hint; when omitted, no hint is
	 * produced and the alert cursor stays put.
	 */
	readonly include?: readonly McpUserContextSection[];
}

/** The ledger's answer to a query; the renderer composes the tool result from it. */
export interface IMcpUserContextData {
	/** The current high-water seq. */
	readonly seq: number;
	/** `since` was outside this run's seq range (a stale value from a previous run). */
	readonly sinceOutOfRange: boolean;
	/** User events in scope (after `since`, or ever for a full snapshot) were evicted. */
	readonly eventsEvicted: boolean;
	/** Console executions visible to the requester, oldest first, capped. */
	readonly consoleEvents: readonly (IMcpConsoleExecutionEvent & { readonly seq: number })[];
	/** How many older matching executions the maxConsoleEntries cap dropped. */
	readonly consoleEventsOmitted: number;
	/** The error subset of the above, capped independently so old errors survive. */
	readonly errorEvents: readonly (IMcpConsoleExecutionEvent & { readonly seq: number })[];
	/** How many older matching error executions the same cap dropped. */
	readonly errorEventsOmitted: number;
	/** Whether each state-like section changed after `since` (true when no since). */
	readonly changed: { readonly session: boolean; readonly editor: boolean; readonly notebooks: boolean };
	/**
	 * Ready-made cursor-advance hint for the session's alert choke point:
	 * present when a response carrying the queried `include` sections covers
	 * everything a `[context: ...]` alert would flag, absent when advancing
	 * would silently un-alert owed events. Computed by the ledger, next to the
	 * alert taxonomy it must mirror.
	 */
	readonly advanceCursor?: { readonly to: number; readonly reportedSince?: number };
}

/** Retention: events kept in memory. Oldest are dropped first. */
const MAX_EVENTS = 300;

/** Retention: per-client alert cursors kept (LRU) across session churn. */
const MAX_CURSORS = 200;

/** Truncate one free-text field to the shared cap, appending `marker` when cut. */
export function truncateContextField(text: string, marker: string): string {
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
			message: truncateContextField(error.message, '\n[message truncated]'),
			traceback,
		};
	}
	return {
		...event,
		code: truncateContextField(event.code, '\n[code truncated]'),
		output: event.output === undefined ? undefined : truncateContextField(event.output, '\n[output truncated - use inspect-variable to read large values]'),
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
	private _seq: number;
	/** This run's first seq value; a `since` below it is from a previous run. */
	private readonly _baseSeq: number;
	/**
	 * Seq of the newest evicted *unattributed* event per window; reads older
	 * than it saw user-activity loss. MCP-attributed evictions are not
	 * tracked: no alert would ever have flagged them, so losing them owes
	 * nobody an "events dropped" signal (a client's own evicted executions go
	 * unflagged too -- a documented tradeoff, it made those calls itself).
	 */
	private readonly _evictedThroughSeqByWindow = new Map<number, number>();
	/** Alert cursor per MCP session id, LRU-bounded. */
	private readonly _cursors = new Map<string, number>();

	/**
	 * @param _capacity Events retained; oldest are evicted first.
	 * @param baseSeq The seq counter's starting value (the first event gets
	 * baseSeq + 1). The production server passes the run start time in
	 * milliseconds, keeping every run's seq range disjoint from and above all
	 * earlier runs' (overtaking wall time would take a sustained 1000+ events
	 * per second), so a client replaying a previous run's `since` is caught by
	 * the range check in {@link query} instead of silently mis-filtering.
	 */
	constructor(private readonly _capacity: number = MAX_EVENTS, baseSeq: number = 0) {
		this._seq = baseSeq;
		this._baseSeq = baseSeq;
	}

	/** The seq of the most recently recorded event (baseSeq before any event). */
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
			const evicted = this._events[0];
			if (evicted.causedByMcpSession === undefined) {
				this._evictedThroughSeqByWindow.set(evicted.windowId, evicted.seq);
			}
			this._events.shift();
		}
		return seq;
	}

	/**
	 * The newest evicted seq a reader scoped to `windowId` could have missed
	 * (baseSeq when nothing in scope was evicted). Per-window so a busy window
	 * evicting its own events never raises "events dropped" signals in a quiet
	 * one.
	 */
	private _evictedThroughSeq(windowId: number | undefined): number {
		if (windowId !== undefined) {
			return this._evictedThroughSeqByWindow.get(windowId) ?? this._baseSeq;
		}
		let max = this._baseSeq;
		for (const seq of this._evictedThroughSeqByWindow.values()) {
			max = Math.max(max, seq);
		}
		return max;
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

	/**
	 * Advance a session's alert cursor because a tool result reported events
	 * through `reportedThroughSeq` itself. The advance only happens when the
	 * report actually covered what the client was owed: a `reportedSince`
	 * ahead of the cursor means events between the cursor and it were skipped,
	 * so the cursor stays put and those events alert normally later. Never
	 * moves the cursor backward or past the high water mark.
	 */
	advanceCursorForReport(sessionId: string, reportedThroughSeq: number, reportedSince: number | undefined): void {
		// A session without a cursor (LRU-evicted) starts at the high water
		// mark, exactly as consumeAlert would seed it.
		const cursor = this._cursors.get(sessionId) ?? this._seq;
		if (reportedSince !== undefined && reportedSince > cursor) {
			return;
		}
		this._setCursor(sessionId, Math.min(Math.max(cursor, reportedThroughSeq), this._seq));
	}

	/**
	 * The `[context: ...]` alert line for a session, or undefined when there is
	 * nothing to report. Consuming: the session's cursor advances to the current
	 * high-water seq either way, so each event is alerted at most once.
	 *
	 * Only events with no MCP attribution are reported (categories and counts
	 * only -- never content), scoped to the session's pinned window. Errors are
	 * flagged distinctly within the execution count.
	 *
	 * The trailing `seq N` is the pre-alert cursor -- the newest seq the client
	 * had already been told about -- so passing it as get-user-context's `since`
	 * returns exactly the events this alert summarized (`query` filters
	 * `seq > since`). Reporting the new high-water here instead would make the
	 * documented follow-up come back empty.
	 */
	consumeAlert(sessionId: string, windowId: number | undefined): string | undefined {
		const cursor = this._cursors.get(sessionId) ?? this._seq;
		this._setCursor(sessionId, this._seq);
		// Events the cursor still owed but the bounded buffer no longer holds:
		// say so rather than silently undercounting (or, when every retained
		// event is filtered out below, staying silent about real activity).
		const dropped = cursor < this._evictedThroughSeq(windowId);
		const events = this._events.filter(event =>
			event.seq > cursor
			&& (windowId === undefined || event.windowId === windowId)
			&& event.causedByMcpSession === undefined);
		if (events.length === 0 && !dropped) {
			return undefined;
		}

		const parts: string[] = [];
		if (dropped) {
			parts.push('earlier events dropped (buffer full)');
		}
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
		parts.push(`seq ${cursor}`);
		return `[context: ${parts.join(' | ')}]`;
	}

	/**
	 * Answer a get-user-context query. `windowId` is the requesting session's
	 * pinned window (resolved by the server); undefined means no window scoping.
	 * Does not touch the alert cursor -- when the query names the sections the
	 * response will `include`, the returned `advanceCursor` hint tells the
	 * session how to advance it once the result is actually delivered.
	 */
	query(query: IMcpUserContextQuery, windowId: number | undefined): IMcpUserContextData {
		// A since outside [baseSeq, seq] is from a previous run (whose seq range
		// lies below this run's, see the constructor) or fabricated: ignore it
		// and return everything rather than silently mis-filtering.
		const sinceOutOfRange = query.since !== undefined && (query.since > this._seq || query.since < this._baseSeq);
		const since = query.since === undefined || sinceOutOfRange ? undefined : query.since;
		const maxEntries = Math.max(1, Math.min(query.maxConsoleEntries ?? DEFAULT_MAX_CONSOLE_ENTRIES, MAX_CONSOLE_ENTRIES_LIMIT));

		const visible = this._events.filter(event =>
			(since === undefined || event.seq > since)
			&& (windowId === undefined || event.windowId === windowId));

		const isOwnOrUsers = (event: McpContextEvent) =>
			event.causedByMcpSession === undefined || event.causedByMcpSession === query.mcpSessionId;
		const executions = visible.filter((event): event is IMcpConsoleExecutionEvent & { seq: number } =>
			event.kind === 'console-execution' && isOwnOrUsers(event));
		const errors = executions.filter(event => event.status === 'error');

		return {
			seq: this._seq,
			sinceOutOfRange,
			eventsEvicted: (since ?? this._baseSeq) < this._evictedThroughSeq(windowId),
			consoleEvents: executions.slice(-maxEntries),
			consoleEventsOmitted: Math.max(0, executions.length - maxEntries),
			errorEvents: errors.slice(-maxEntries),
			errorEventsOmitted: Math.max(0, errors.length - maxEntries),
			changed: {
				session: since === undefined || visible.some(event => event.kind === 'session-change'),
				editor: since === undefined || visible.some(event => event.kind === 'editor-change'),
				notebooks: since === undefined || visible.some(event => event.kind === 'notebook-open' || event.kind === 'notebook-close'),
			},
			advanceCursor: this._coversAlerts(query.include, visible, executions, maxEntries)
				? { to: this._seq, reportedSince: since }
				: undefined,
		};
	}

	/**
	 * Whether a response carrying the `include` sections covers everything
	 * {@link consumeAlert} would flag over the same range: each alert category
	 * either has no unattributed events here, or its section is included --
	 * and for console executions, none of the unattributed ones were cut by
	 * the maxConsoleEntries cap (an omission count in a note is not the
	 * content the client is owed). Lives next to consumeAlert so both sides of
	 * the alert category taxonomy stay in this one class; the session's
	 * choke point then merely forwards the resulting hint and
	 * {@link advanceCursorForReport} guards it against a skipped-ahead since.
	 */
	private _coversAlerts(include: readonly McpUserContextSection[] | undefined, visible: readonly McpContextEvent[], executions: readonly (IMcpConsoleExecutionEvent & { seq: number })[], maxEntries: number): boolean {
		if (include === undefined) {
			return false;
		}
		const included = new Set(include);
		const alertable = visible.filter(event => event.causedByMcpSession === undefined);
		const coversExecutions = included.has('console')
			? !executions.slice(0, Math.max(0, executions.length - maxEntries)).some(event => event.causedByMcpSession === undefined)
			: !alertable.some(event => event.kind === 'console-execution');
		return coversExecutions
			&& (included.has('editor') || !alertable.some(event => event.kind === 'editor-change'))
			&& (included.has('notebooks') || !alertable.some(event => event.kind === 'notebook-open' || event.kind === 'notebook-close'))
			&& (included.has('session') || !alertable.some(event => event.kind === 'session-change'));
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
		if (args.include.length === 0) {
			// An empty include has no legitimate use; erroring gives the model
			// a self-correction where a bare seq-only success gives no signal.
			throw new Error(`include must not be empty; omit it for all sections, or pick from: ${MCP_USER_CONTEXT_SECTIONS.join(', ')}.`);
		}
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
		if (typeof args.maxConsoleEntries !== 'number' || !Number.isInteger(args.maxConsoleEntries) || args.maxConsoleEntries < 1 || args.maxConsoleEntries > MAX_CONSOLE_ENTRIES_LIMIT) {
			// Erroring names the valid range (matching the schema's declared
			// maximum) where a silent clamp would send a client following the
			// "raise maxConsoleEntries" note into a no-signal retry loop.
			throw new Error(`maxConsoleEntries must be an integer between 1 and ${MAX_CONSOLE_ENTRIES_LIMIT}.`);
		}
		maxConsoleEntries = args.maxConsoleEntries;
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
	/**
	 * `isToolTarget` marks the notebook the notebook-* tools currently act on
	 * (the most recently used one, focused or not). Deliberately not a focus
	 * signal -- the `editor` section carries focus.
	 */
	readonly notebooks: readonly { readonly path: string; readonly isToolTarget: boolean }[];
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
	if (data.sinceOutOfRange) {
		notes.push(`since=${args.since} is not from this run (sequence numbers reset when Positron restarts); ignoring it.`);
	}
	if (data.eventsEvicted) {
		notes.push('Events older than the retained window were already dropped from the server\'s bounded event buffer; console/errors may be incomplete.');
	}
	// At the cap there is nothing to raise: entries sliced off by the newest-N
	// window have no paging path (since only filters newer), so say so instead
	// of suggesting a value the parser would reject.
	const omittedRemedy = args.maxConsoleEntries >= MAX_CONSOLE_ENTRIES_LIMIT
		? `they are beyond the maxConsoleEntries cap (${MAX_CONSOLE_ENTRIES_LIMIT}) and not retrievable`
		: `raise maxConsoleEntries (max ${MAX_CONSOLE_ENTRIES_LIMIT}) to see them`;
	if (args.include.has('console') && data.consoleEventsOmitted > 0) {
		notes.push(`${data.consoleEventsOmitted} older console execution${data.consoleEventsOmitted === 1 ? ' was' : 's were'} omitted; ${omittedRemedy}.`);
	}
	if (args.include.has('errors') && data.errorEventsOmitted > 0) {
		notes.push(`${data.errorEventsOmitted} older error${data.errorEventsOmitted === 1 ? ' was' : 's were'} omitted; ${omittedRemedy}.`);
	}

	const response: Record<string, unknown> = { seq: data.seq };
	if (notes.length > 0) {
		response.note = notes.join(' ');
	}
	if (args.include.has('session') && data.changed.session) {
		response.session = snapshot.session;
	}
	if (args.include.has('editor') && data.changed.editor) {
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
	if (args.include.has('notebooks') && data.changed.notebooks) {
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
			// The ledger computed this hint alongside the query (and validates
			// it again when the session applies it); a narrower response gets
			// no hint, trading a possibly-repetitive next alert for never
			// silently un-alerting events the client was owed.
			advanceContextCursor: data.advanceCursor,
		},
	};
}
