/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Audit-event types and formatting for the Positron MCP server. One structured
 * event is recorded per tool call at the main-process choke point
 * (PositronMcpSession._callTool), plus session-lifecycle markers. Events fan out
 * to the "Positron MCP" log channel (via {@link formatAuditLine}) and to an
 * in-memory {@link McpAuditRingBuffer} surfaced through the server status.
 *
 * Every event field is a scalar or optional scalar: events cross the
 * main->renderer ProxyChannel and the `getStatus()` poll, so they must stay
 * JSON-serializable -- never add URI or class instances here.
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
	readonly outcome: 'ok' | 'error';
	readonly durationMs: number;
	readonly pinnedWindowId?: number;
	/** Content-block types + sizes; never content. */
	readonly resultSummary: string;
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
	readonly pinnedWindowId?: number;
}

/** Session lifecycle markers. */
export interface IMcpLifecycleAuditEvent {
	readonly type: 'session-created' | 'session-resumed' | 'session-closed' | 'client-identified' | 'window-repinned';
	readonly timestamp: number;
	readonly sessionId: string;
	readonly clientName?: string;
	readonly clientVersion?: string;
	readonly pinnedWindowId?: number;
}

export type McpAuditEvent = IMcpToolCallAuditEvent | IMcpToolCallStartEvent | IMcpLifecycleAuditEvent;

/** The sink a session records events into; the server owns the implementation. */
export interface IPositronMcpAuditLog {
	record(event: McpAuditEvent): void;
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
			const window = event.pinnedWindowId !== undefined ? ` (window ${event.pinnedWindowId})` : '';
			return `${prefix} tools/call ${event.toolName}${client ? ` by ${client}` : ''} -> ${event.outcome} in ${event.durationMs}ms${window} | args ${event.argsSummary} | result ${event.resultSummary}`;
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
			return `${prefix} client identified: ${clientLabel(event.clientName, event.clientVersion) ?? 'unknown'} (window ${event.pinnedWindowId ?? 'none'})`;
		case 'window-repinned':
			return `${prefix} pinned window unavailable; re-pinned to ${event.pinnedWindowId ?? 'none'}`;
	}
}

/**
 * Fixed-capacity buffer of recent audit events, oldest dropped first.
 * `tool-call-start` events are not buffered (see {@link IMcpToolCallStartEvent}).
 */
export class McpAuditRingBuffer {
	private readonly _events: McpAuditEvent[] = [];

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

	snapshot(): readonly McpAuditEvent[] {
		return [...this._events];
	}
}
