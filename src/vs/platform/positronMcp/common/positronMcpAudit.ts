/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Audit-event types and formatting for the Positron MCP server. One structured
 * event is recorded per tool call at the main-process choke point
 * (PositronMcpSession._callTool), plus session-lifecycle markers. Events fan out
 * to the "Positron MCP" log channel (via {@link formatAuditLine}), to an
 * in-memory {@link McpAuditRingBuffer} surfaced through the server status, and
 * to a JSONL audit file (via {@link toJsonlRecord}).
 *
 * Every event field is a scalar or optional scalar: events cross the
 * main->renderer ProxyChannel and the `getStatus()` poll, so they must stay
 * JSON-serializable -- never add URI or class instances here. The exceptions
 * are {@link IMcpToolCallAuditEvent.args} and
 * {@link IMcpToolCallAuditEvent.contextAlert}, which the server strips before
 * any fan-out beyond the JSONL file sink.
 */

import { IMcpCallToolResult } from './positronMcpTools.js';

/** One completed tool call, recorded on every exit path exactly once. */
export interface IMcpToolCallAuditEvent {
	readonly type: 'tool-call';
	/** Pairs this completion with its matching tool-call-start. */
	readonly callId: string;
	/** Epoch milliseconds at completion. */
	readonly timestamp: number;
	readonly sessionId: string;
	readonly clientName?: string;
	readonly clientVersion?: string;
	readonly toolName: string;
	/** Argument keys + safe scalars + truncated code preview; never full values. */
	readonly argsSummary: string;
	/**
	 * Complete tool arguments, verbatim (JSON-safe by construction: they arrive
	 * parsed from the request body). Reaches disk only through the JSONL sink
	 * when the audit detail is 'full'; the server strips it before the ring
	 * buffer, the status poll, and the renderer-facing activity emitter.
	 */
	readonly args?: Record<string, unknown>;
	readonly outcome: 'ok' | 'error';
	readonly durationMs: number;
	/** The window this session's tool calls run in -- fixed for the session's lifetime. */
	readonly pinnedWindowId: number;
	/** Content-block types + sizes; never content. */
	readonly resultSummary: string;
	/**
	 * The `[context: ...]` alert line appended to this result, if one was.
	 * Categories and counts only (never content), but like {@link args} it
	 * reaches disk only through the JSONL sink at 'full' detail; the server
	 * strips it before every other fan-out.
	 */
	readonly contextAlert?: string;
	/**
	 * The result carried console history (a get-user-context call with a
	 * non-empty console/errors section) -- the most sensitive read this server
	 * exposes. Such calls are written to the JSONL file at full detail even
	 * when the detail setting is 'summary', so the audit trail always shows
	 * exactly what was asked for.
	 */
	readonly returnedConsoleContent?: boolean;
}

/**
 * A tool call entering flight. Drives the live status bar indicator only; start
 * events are transient UI state, never audit history (the ring buffer and the
 * info-level log hold only completed calls).
 */
export interface IMcpToolCallStartEvent {
	readonly type: 'tool-call-start';
	readonly callId: string;
	readonly timestamp: number;
	readonly sessionId: string;
	readonly clientName?: string;
	readonly toolName: string;
	readonly pinnedWindowId: number;
}

/** Session lifecycle markers. */
export interface IMcpLifecycleAuditEvent {
	readonly type: 'session-created' | 'session-resumed' | 'session-closed' | 'client-identified';
	readonly timestamp: number;
	readonly sessionId: string;
	readonly clientName?: string;
	readonly clientVersion?: string;
	readonly pinnedWindowId: number;
}

export type McpAuditEvent = IMcpToolCallAuditEvent | IMcpToolCallStartEvent | IMcpLifecycleAuditEvent;

/**
 * An audit event that belongs in activity history: completed tool calls and
 * lifecycle markers, never transient `tool-call-start` events. The ring buffer
 * and the status snapshot carry this type, so consumers need no runtime
 * "not a start event" handling.
 */
export type McpCompletedAuditEvent = IMcpToolCallAuditEvent | IMcpLifecycleAuditEvent;

/**
 * The event with the fields only the JSONL file sink may see removed: complete
 * arguments and the context-alert line. This is the single definition of which
 * tool-call fields are too sensitive to fan out; both the server's emit path
 * and the summary-detail file records go through it.
 */
export function toSummaryOnlyEvent(event: IMcpToolCallAuditEvent): IMcpToolCallAuditEvent {
	const { args: _args, contextAlert: _contextAlert, ...summaryOnly } = event;
	return summaryOnly;
}

/** The sink a session records events into; the server owns the implementation. */
export interface IPositronMcpAuditLog {
	record(event: McpAuditEvent): void;
}

/**
 * How much the JSONL audit file records per tool call: 'summary' keeps the
 * argument summary only, 'full' additionally keeps complete arguments (code and
 * paths -- never result data), 'off' writes no file at all. Mirrors the
 * `positron.mcp.auditLog.detail` setting.
 */
export type McpAuditLogDetail = 'summary' | 'full' | 'off';

/**
 * Shape an audit event into one JSONL audit-file line, or undefined when the
 * event should not be persisted: transient `tool-call-start` events never are,
 * and 'off' disables the file entirely. Full arguments (and the context-alert
 * line) survive only at 'full' detail -- any other value behaves as 'summary'
 * -- except that a call which returned console content is always recorded at
 * full detail, so the sensitive read is fully accounted for.
 */
export function toJsonlRecord(event: McpAuditEvent, detail: McpAuditLogDetail): string | undefined {
	if (detail === 'off' || event.type === 'tool-call-start') {
		return undefined;
	}
	if (event.type === 'tool-call' && detail !== 'full' && !event.returnedConsoleContent) {
		return JSON.stringify(toSummaryOnlyEvent(event));
	}
	return JSON.stringify(event);
}

/** Max preview length for code-carrying string arguments. */
const CODE_PREVIEW_LENGTH = 200;
/** Max preview length for other string arguments. */
const STRING_PREVIEW_LENGTH = 60;
/** Argument keys whose string values are code and get the longer preview. */
const CODE_ARG_KEYS = new Set(['code', 'source']);

function previewString(value: string, maxLength: number): string {
	const escaped = value.replace(/\r?\n/g, '\\n');
	const truncated = escaped.length > maxLength ? `${escaped.slice(0, maxLength)}...` : escaped;
	return `"${truncated}"`;
}

/**
 * Summarize tool-call arguments for the audit trail: every key is listed;
 * booleans and numbers verbatim; strings as truncated previews (longer for code
 * keys); arrays and objects opaquely. Never emits a full long value.
 */
export function summarizeArgs(args: Record<string, unknown>): string {
	const parts = Object.entries(args).map(([key, value]) => {
		let rendered: string;
		if (typeof value === 'string') {
			rendered = previewString(value, CODE_ARG_KEYS.has(key) ? CODE_PREVIEW_LENGTH : STRING_PREVIEW_LENGTH);
		} else if (typeof value === 'boolean' || typeof value === 'number') {
			rendered = String(value);
		} else if (Array.isArray(value)) {
			rendered = `[${value.length} items]`;
		} else if (value === null || value === undefined) {
			rendered = String(value);
		} else {
			rendered = '{object}';
		}
		return `${key}: ${rendered}`;
	});
	return `{${parts.join(', ')}}`;
}

function formatSize(bytes: number): string {
	return bytes < 1024 ? `${bytes}B` : `${Math.round(bytes / 1024)}KB`;
}

/**
 * Summarize a tool result as content-block types and sizes, e.g.
 * `text(532 chars), image(45KB image/png)`. Never includes the content itself.
 */
export function summarizeResult(result: IMcpCallToolResult): string {
	if (result.content.length === 0) {
		return '(empty)';
	}
	return result.content.map(block =>
		block.type === 'text'
			? `text(${block.text.length} chars)`
			: `image(${formatSize(block.data.length)} ${block.mimeType})`
	).join(', ');
}

function clientLabel(clientName: string | undefined, clientVersion?: string): string | undefined {
	return clientName ? `${clientName}${clientVersion ? ` ${clientVersion}` : ''}` : undefined;
}

/** The human-readable audit line written to the "Positron MCP" log channel. */
export function formatAuditLine(event: McpAuditEvent): string {
	const prefix = `[PositronMcpSession ${event.sessionId}]`;
	switch (event.type) {
		case 'tool-call': {
			const client = clientLabel(event.clientName, event.clientVersion);
			return `${prefix} tools/call ${event.toolName}${client ? ` by ${client}` : ''} -> ${event.outcome} in ${event.durationMs}ms (window ${event.pinnedWindowId}) | args ${event.argsSummary} | result ${event.resultSummary}`;
		}
		case 'tool-call-start': {
			const client = clientLabel(event.clientName);
			return `${prefix} tools/call ${event.toolName}${client ? ` by ${client}` : ''} started`;
		}
		case 'session-created':
			return `${prefix} session created`;
		case 'session-resumed':
			return `${prefix} session resumed from a stale id (client unknown until it re-initializes)`;
		case 'session-closed':
			return `${prefix} session closed by client`;
		case 'client-identified':
			return `${prefix} client identified: ${clientLabel(event.clientName, event.clientVersion) ?? 'unknown'} (window ${event.pinnedWindowId})`;
	}
}

/**
 * Fixed-capacity buffer of recent audit events, oldest dropped first.
 * `tool-call-start` events are not buffered (see {@link IMcpToolCallStartEvent}).
 */
export class McpAuditRingBuffer {
	private readonly _events: McpCompletedAuditEvent[] = [];

	constructor(private readonly _capacity: number = 200) { }

	push(event: McpAuditEvent): void {
		if (event.type === 'tool-call-start') {
			return;
		}
		this._events.push(event);
		if (this._events.length > this._capacity) {
			this._events.shift();
		}
	}

	snapshot(): readonly McpCompletedAuditEvent[] {
		return [...this._events];
	}
}

/**
 * Safety net for a start event whose matching completion never arrived (the
 * session guarantees pairing, so this should never trip in practice).
 */
const STALE_CALL_MS = 10 * 60 * 1000;

/**
 * Tracks the tool calls currently in flight from paired start/completion audit
 * events, for live UI (the activity pane's spinners, the status bar). Shared so
 * the pairing and stale-sweep rules live in one place.
 */
export class McpInFlightCallTracker {
	/** In-flight calls keyed by the audit callId. */
	private readonly _calls = new Map<string, IMcpToolCallStartEvent>();

	/**
	 * Update from one audit event: a start is added, a completion removes its
	 * pair and sweeps stale leftovers. Returns whether the event was in-flight
	 * relevant (a start or completion), so callers can skip re-rendering on
	 * lifecycle events.
	 */
	apply(event: McpAuditEvent): boolean {
		if (event.type === 'tool-call-start') {
			this._calls.set(event.callId, event);
			return true;
		}
		if (event.type !== 'tool-call') {
			return false;
		}
		this._calls.delete(event.callId);
		this.sweepStale();
		return true;
	}

	/** Drop calls whose completion never arrived within the stale window. */
	sweepStale(): void {
		const cutoff = Date.now() - STALE_CALL_MS;
		for (const [callId, call] of this._calls) {
			if (call.timestamp < cutoff) {
				this._calls.delete(callId);
			}
		}
	}

	/** The in-flight calls, oldest start first. */
	get calls(): IMcpToolCallStartEvent[] {
		return [...this._calls.values()].sort((a, b) => a.timestamp - b.timestamp);
	}

	/** The most recently started in-flight call, when any are running. */
	get latest(): IMcpToolCallStartEvent | undefined {
		let latest: IMcpToolCallStartEvent | undefined;
		for (const call of this._calls.values()) {
			if (!latest || call.timestamp >= latest.timestamp) {
				latest = call;
			}
		}
		return latest;
	}

	get size(): number {
		return this._calls.size;
	}

	clear(): void {
		this._calls.clear();
	}
}
