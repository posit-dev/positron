/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { IPCServer } from '../../../base/parts/ipc/common/ipc.js';
import { ILogger, ILoggerService } from '../../log/common/log.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import {
	ClaudeCliRegistrationState,
	IMcpSessionInfo,
	IPositronMcpAggregateStatus,
	IPositronMcpMainService,
	IPositronMcpWindowStatus,
	POSITRON_MCP_LOG_ID,
} from '../common/positronMcp.js';
import { formatAuditLine, McpAuditEvent, McpAuditLogDetail, McpAuditRingBuffer, toSummaryOnlyEvent } from '../common/positronMcpAudit.js';
import { IMcpUserContextData, IMcpUserContextQuery, McpContextEventInput, McpContextLedger } from '../common/positronMcpContext.js';
import { reportMcpTelemetry } from '../common/positronMcpTelemetry.js';
import { McpAuditFileWriter } from './positronMcpAuditFile.js';
import { PositronMcpWindowServer } from './positronMcpServer.js';
import { loadOrCreateMcpToken } from './positronMcpToken.js';
import { PositronMcpToolBroker } from './positronMcpToolBroker.js';

/**
 * Main-process registry owning one {@link PositronMcpWindowServer} per open
 * Positron window, plus the state shared across all of them: the bearer
 * token, the JSONL audit file, the recent-activity ring buffer, and the
 * user-context ledger. Splitting it this way means only the HTTP listener
 * (and the session map it owns) is per-window -- everything a client should
 * see the same way regardless of which window's port it's talking to stays a
 * single instance.
 *
 * Every public method takes an explicit leading `windowId`, supplied
 * transparently by the renderer-side service wrapper (see
 * {@link IPositronMcpMainService}) -- callers of {@link IPositronMcpService}
 * never pass it themselves.
 */
export class PositronMcpServerRegistry extends Disposable implements IPositronMcpMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _logger: ILogger;
	private readonly _token: string;
	private readonly _auditFile: McpAuditFileWriter;
	private readonly _windowServers = this._register(new DisposableMap<number, PositronMcpWindowServer>());

	/**
	 * Recent audit events for the status UI. Intentionally not cleared when a
	 * window's server stops: sessions are wiped but the history of what agents
	 * did is not.
	 */
	private readonly _recentActivity = new McpAuditRingBuffer(200);

	/**
	 * The user-activity ledger behind get-user-context and the `[context: ...]`
	 * alert lines. A registry-lifetime field like the activity buffer: it
	 * survives any single window's server stopping and window reloads, so
	 * event seqs stay monotonic for the whole Positron run and only reset when
	 * the app quits.
	 */
	// Seqs are based at the run start time so a `since` replayed from a
	// previous run is detectable; see the McpContextLedger constructor.
	private readonly _contextLedger = new McpContextLedger(undefined, Date.now());
	private readonly _onDidRecordActivity = this._register(new Emitter<McpAuditEvent>());
	// Must be an instance field (not a getter): ProxyChannel.fromService discovers
	// events with a for...in scan of own enumerable properties (ipc.ts).
	readonly onDidRecordActivity = this._onDidRecordActivity.event;

	constructor(
		private readonly _ipcServer: IPCServer<string>,
		auditFilePath: string,
		tokenFilePath: string,
		@ILoggerService loggerService: ILoggerService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
		this._logger = this._register(loggerService.createLogger(POSITRON_MCP_LOG_ID, { name: 'Positron MCP', logLevel: 'always' }));
		this._auditFile = this._register(new McpAuditFileWriter(auditFilePath, this._logger));
		this._token = loadOrCreateMcpToken(tokenFilePath, message => this._logger.warn(`[PositronMcpServerRegistry] ${message}`));
		this._logger.info('[PositronMcpServerRegistry] Initialized');
	}

	/**
	 * Adopt the renderer's `positron.mcp.auditLog.detail` value. The main
	 * process cannot read workbench settings, so the lifecycle contribution
	 * pushes it here at startup and whenever it changes; multiple windows push
	 * the same value idempotently. Applies from the next audit event.
	 */
	async setAuditLogDetail(_windowId: number, detail: McpAuditLogDetail): Promise<void> {
		this._auditFile.detail = detail;
	}

	async start(windowId: number): Promise<void> {
		return this._windowServer(windowId).start();
	}

	async stop(windowId: number): Promise<void> {
		await this._windowServers.get(windowId)?.stop();
	}

	async getStatus(windowId: number): Promise<IPositronMcpWindowStatus> {
		const server = this._windowServers.get(windowId);
		const own = server ? await server.getStatus() : { running: false, port: 0, sessions: [] };
		return { ...own, token: this._token, auditLogPath: this._auditFile.path };
	}

	async getAggregateStatus(_windowId: number): Promise<IPositronMcpAggregateStatus> {
		const sessions: IMcpSessionInfo[] = [];
		for (const server of this._windowServers.values()) {
			sessions.push(...(await server.getStatus()).sessions);
		}
		return {
			token: this._token,
			sessions,
			recentActivity: this._recentActivity.snapshot(),
			auditLogPath: this._auditFile.path,
			// TODO(Phase 6): wire up the real Claude Code CLI registration state.
			claudeCliState: 'unknown',
		};
	}

	async recordContextEvent(_windowId: number, event: McpContextEventInput): Promise<void> {
		this._contextLedger.record(event);
	}

	async queryUserContext(windowId: number, query: IMcpUserContextQuery): Promise<IMcpUserContextData> {
		return this._contextLedger.query(query, windowId);
	}

	async ensureClaudeCliRegistered(_windowId: number): Promise<ClaudeCliRegistrationState> {
		// TODO(Phase 6): shell out to `claude mcp add` with the bundled stdio proxy.
		return 'unknown';
	}

	/**
	 * Safety net for a window that closed without the renderer ever calling
	 * `stop()` (e.g. a crash): tears down its server and frees the port.
	 */
	disposeWindow(windowId: number): void {
		this._windowServers.deleteAndDispose(windowId);
	}

	private _windowServer(windowId: number): PositronMcpWindowServer {
		let server = this._windowServers.get(windowId);
		if (!server) {
			const broker = new PositronMcpToolBroker(this._ipcServer, windowId);
			server = new PositronMcpWindowServer(windowId, this._token, broker, { record: e => this._recordAudit(e) }, this._contextLedger, this._logger);
			this._windowServers.set(windowId, server);
		}
		return server;
	}

	/**
	 * The audit sink every session records into. Start events only feed the live
	 * activity emitter (transient in-flight state); completed calls and lifecycle
	 * events also land in the log channel, the ring buffer, and the JSONL audit
	 * file. Only the file sink ever sees complete tool arguments: everything
	 * downstream of it gets the summary-only event, so full argument values
	 * never reach the ring buffer, the status poll, or the renderer emitter.
	 */
	private _recordAudit(event: McpAuditEvent): void {
		this._auditFile.write(event);
		if (event.type === 'tool-call' && (event.args !== undefined || event.contextAlert !== undefined)) {
			event = toSummaryOnlyEvent(event);
		}
		if (event.type === 'tool-call-start') {
			this._logger.debug(formatAuditLine(event));
		} else {
			this._logger.info(formatAuditLine(event));
			this._recentActivity.push(event);
		}
		reportMcpTelemetry(this._telemetryService, event);
		this._onDidRecordActivity.fire(event);
	}
}
