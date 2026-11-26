/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IAgentTerminal, IAgentTerminalCommand, IAgentTerminalCreateOptions, IAgentTerminalOutput, IAgentTerminalStatus, IPositronAgentTerminalService } from '../../../contrib/positronAgentTerminal/common/agentTerminalService.js';
import { MainPositronContext, MainThreadAgentTerminalShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAgentTerminal)
export class MainThreadAgentTerminal implements MainThreadAgentTerminalShape {

	constructor(
		_extHostContext: IExtHostContext,
		@IPositronAgentTerminalService private readonly _agentTerminalService: IPositronAgentTerminalService,
	) { }

	$createTerminal(extensionId: string, options: IAgentTerminalCreateOptions): Promise<IAgentTerminal> {
		const cwd = typeof options.cwd === 'string' || !options.cwd ? options.cwd : URI.revive(options.cwd);
		return this._agentTerminalService.createTerminal(extensionId, { ...options, cwd });
	}

	$getTerminals(extensionId: string): Promise<IAgentTerminal[]> {
		return this._agentTerminalService.getTerminals(extensionId);
	}

	$runCommand(extensionId: string, terminalId: string, commandLine: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		return this._agentTerminalService.runCommand(extensionId, terminalId, commandLine, waitMs, token);
	}

	$waitForCommand(extensionId: string, terminalId: string, commandId: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		return this._agentTerminalService.waitForCommand(extensionId, terminalId, commandId, waitMs, token);
	}

	async $getStatus(extensionId: string, terminalId: string): Promise<IAgentTerminalStatus> {
		return this._agentTerminalService.getStatus(extensionId, terminalId);
	}

	async $readOutput(extensionId: string, terminalId: string, commandId: string, offset: number, limit: number): Promise<IAgentTerminalOutput> {
		return this._agentTerminalService.readOutput(extensionId, terminalId, commandId, offset, limit);
	}

	$interrupt(extensionId: string, terminalId: string): Promise<void> {
		return this._agentTerminalService.interrupt(extensionId, terminalId);
	}

	$show(extensionId: string, terminalId: string, preserveFocus: boolean): Promise<void> {
		return this._agentTerminalService.show(extensionId, terminalId, preserveFocus);
	}

	async $disposeTerminal(extensionId: string, terminalId: string): Promise<void> {
		this._agentTerminalService.disposeTerminal(extensionId, terminalId);
	}

	dispose(): void { }
}
