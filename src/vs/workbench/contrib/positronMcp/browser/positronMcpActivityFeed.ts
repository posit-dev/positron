/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Delayer } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMcpSessionInfo, IPositronMcpService } from '../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpToolCallStartEvent, McpAuditEvent } from '../../../../platform/positronMcp/common/positronMcpAudit.js';
import { IPositronMcpToolService } from './positronMcpToolService.js';

/**
 * How long after an audit event the feed re-reads the server status. Batches
 * bursts of tool calls into one round trip; the reconcile keeps the session
 * table (created/last-activity times, closures) authoritative.
 */
const RECONCILE_DELAY_MS = 500;

/**
 * Safety net for a start event whose matching completion never arrived (the
 * session guarantees pairing, so this should never trip in practice). Matches
 * the status bar's guard.
 */
const STALE_CALL_MS = 10 * 60 * 1000;

/** Everything the activity pane renders, as one immutable snapshot. */
export interface IMcpActivityState {
	/** Whether the HTTP server is currently listening. */
	readonly running: boolean;
	/** The live MCP sessions, oldest first. */
	readonly sessions: readonly IMcpSessionInfo[];
	/** Completed tool calls + lifecycle events, oldest first, server-capped. */
	readonly events: readonly McpAuditEvent[];
	/** Tool calls currently in flight, oldest start first. */
	readonly inFlight: readonly IMcpToolCallStartEvent[];
	/** Whether the user has allowed all agent code execution for this session. */
	readonly allowAll: boolean;
}

/**
 * The live data source behind the MCP activity pane: seeds from the server's
 * status snapshot, then stays current from the pushed audit-event stream
 * (`onDidRecordActivity` is bridged from the main process over the proxy
 * channel, so no polling). In-flight calls are tracked purely from start/
 * completion events; the session table is reconciled with a debounced status
 * re-read because its timestamps and closures live server-side.
 */
export class PositronMcpActivityFeed extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	/** Fires whenever {@link state} has changed. */
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _reconcileDelayer = this._register(new Delayer<void>(RECONCILE_DELAY_MS));

	/** Completed calls + lifecycle events, oldest first. */
	private _events: McpAuditEvent[] = [];
	/** Tool calls currently in flight, keyed by the audit callId. */
	private readonly _inFlight = new Map<string, IMcpToolCallStartEvent>();
	private _sessions: readonly IMcpSessionInfo[] = [];
	private _running = false;
	private _allowAll: boolean;
	/**
	 * Until the first status read lands, pushed completion/lifecycle events are
	 * not appended: the snapshot that seeds `_events` already contains them
	 * (the server buffers before it emits).
	 */
	private _seeded = false;

	constructor(
		@IPositronMcpService private readonly _mcpService: IPositronMcpService,
		@IPositronMcpToolService private readonly _toolService: IPositronMcpToolService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._allowAll = this._toolService.isAllowAllConsentActive();
		this._register(this._mcpService.onDidRecordActivity(event => this._onActivity(event)));
		this._register(this._toolService.onDidChangeAllowAllConsent(value => {
			this._allowAll = value;
			this._onDidChange.fire();
		}));
		void this.refresh();
	}

	get state(): IMcpActivityState {
		return {
			running: this._running,
			sessions: this._sessions,
			events: this._events,
			inFlight: [...this._inFlight.values()].sort((a, b) => a.timestamp - b.timestamp),
			allowAll: this._allowAll,
		};
	}

	/** Replace the feed's snapshot state from a fresh status read. Never throws. */
	async refresh(): Promise<void> {
		let status;
		try {
			status = await this._mcpService.getStatus();
		} catch (err) {
			// A failed read leaves the last snapshot on screen; the next audit
			// event schedules another attempt.
			this._logService.warn('[PositronMcpActivityFeed] status read failed', err);
			return;
		}
		this._events = [...status.recentActivity];
		this._sessions = status.sessions;
		this._running = status.running;
		this._seeded = true;
		this._sweepStaleInFlight();
		this._onDidChange.fire();
	}

	/** Clear all cached code-execution consent (the consent banner's Reset). */
	resetConsent(): void {
		this._toolService.resetConsent();
	}

	private _onActivity(event: McpAuditEvent): void {
		if (event.type === 'tool-call-start') {
			this._inFlight.set(event.callId, event);
			this._onDidChange.fire();
			return;
		}
		if (event.type === 'tool-call') {
			this._inFlight.delete(event.callId);
			this._sweepStaleInFlight();
		}
		if (this._seeded) {
			this._events.push(event);
		}
		this._onDidChange.fire();
		// Session created/last-activity times (and closures) changed server-side.
		// refresh() never throws; the only rejection is the delayer cancelling a
		// pending trigger on dispose.
		this._reconcileDelayer.trigger(() => this.refresh()).catch(() => undefined);
	}

	private _sweepStaleInFlight(): void {
		const cutoff = Date.now() - STALE_CALL_MS;
		for (const [callId, call] of this._inFlight) {
			if (call.timestamp < cutoff) {
				this._inFlight.delete(callId);
			}
		}
	}
}
