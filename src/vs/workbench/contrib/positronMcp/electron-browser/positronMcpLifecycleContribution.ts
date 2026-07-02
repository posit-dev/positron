/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPositronMcpService, PositronMcpToolBrokerChannelName } from '../../../../platform/positronMcp/common/positronMcp.js';
import { McpAuditLogDetail } from '../../../../platform/positronMcp/common/positronMcpAudit.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IPositronMcpToolService } from '../browser/positronMcpToolService.js';
import { AUDIT_LOG_DETAIL_KEY, MCP_ENABLE_KEY } from '../common/positronMcpConfiguration.js';
import { PositronMcpToolBrokerChannel } from './positronMcpToolBrokerChannel.js';

/**
 * Renderer-side driver for the main-process MCP server.
 *
 * The main process cannot read workbench settings, so this contribution owns the
 * lifecycle: it starts the server when `positron.mcp.enable` is on (and AI
 * features are enabled), stops it otherwise, and reacts to changes in either
 * setting. The server itself is a singleton in the main process; if multiple
 * windows are open they each drive the same shared server idempotently.
 */
export class PositronMcpLifecycleContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IPositronMcpService private readonly _mcpService: IPositronMcpService,
		@IPositronMcpToolService toolService: IPositronMcpToolService,
	) {
		super();

		// Register this window's tool broker so the main-process server can route
		// tool calls here when this window is the pinned target.
		mainProcessService.registerChannel(PositronMcpToolBrokerChannelName, new PositronMcpToolBrokerChannel(toolService));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(MCP_ENABLE_KEY) || e.affectsConfiguration(AI_ENABLED_KEY)) {
				this._sync();
			}
			if (e.affectsConfiguration(AUDIT_LOG_DETAIL_KEY)) {
				this._syncAuditLogDetail();
			}
		}));
		this._syncAuditLogDetail();
		this._sync();
	}

	/**
	 * Push the audit-file detail setting to the main-process server, which cannot
	 * read workbench settings itself. All windows push the same value.
	 */
	private _syncAuditLogDetail(): void {
		const detail = this._configurationService.getValue<McpAuditLogDetail>(AUDIT_LOG_DETAIL_KEY) ?? 'summary';
		this._mcpService.setAuditLogDetail(detail)
			.catch(err => this._logService.error('[PositronMcp] Failed to update audit log detail', err));
	}

	/** Whether the server should be running given the current settings. */
	private _shouldRun(): boolean {
		const enabled = this._configurationService.getValue<boolean>(MCP_ENABLE_KEY) === true;
		const aiEnabled = this._configurationService.getValue<boolean>(AI_ENABLED_KEY) !== false;
		return enabled && aiEnabled;
	}

	private _sync(): void {
		const run = this._shouldRun();
		const action = run ? this._mcpService.start() : this._mcpService.stop();
		action.catch(err => this._logService.error(`[PositronMcp] Failed to ${run ? 'start' : 'stop'} server`, err));
	}
}
