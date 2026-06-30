/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPositronMcpService, PositronMcpChannelName, PositronMcpToolBrokerChannelName } from '../../../../platform/positronMcp/common/positronMcp.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IPositronMcpToolService } from '../browser/positronMcpToolService.js';
import { MCP_ENABLE_KEY } from '../common/positronMcpConfiguration.js';
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
	private readonly _proxy: IPositronMcpService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IPositronMcpToolService toolService: IPositronMcpToolService,
	) {
		super();
		this._proxy = ProxyChannel.toService<IPositronMcpService>(mainProcessService.getChannel(PositronMcpChannelName));

		// Register this window's tool broker so the main-process server can route
		// tool calls here when this window is the pinned target.
		mainProcessService.registerChannel(PositronMcpToolBrokerChannelName, new PositronMcpToolBrokerChannel(toolService));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(MCP_ENABLE_KEY) || e.affectsConfiguration(AI_ENABLED_KEY)) {
				this._sync();
			}
		}));
		this._sync();
	}

	/** Whether the server should be running given the current settings. */
	private _shouldRun(): boolean {
		const enabled = this._configurationService.getValue<boolean>(MCP_ENABLE_KEY) === true;
		const aiEnabled = this._configurationService.getValue<boolean>(AI_ENABLED_KEY) !== false;
		return enabled && aiEnabled;
	}

	private _sync(): void {
		const run = this._shouldRun();
		const action = run ? this._proxy.start() : this._proxy.stop();
		action.catch(err => this._logService.error(`[PositronMcp] Failed to ${run ? 'start' : 'stop'} server`, err));
	}
}
