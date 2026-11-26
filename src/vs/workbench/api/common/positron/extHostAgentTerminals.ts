/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import type * as vscode from 'vscode';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IAgentTerminal, DEFAULT_READ_LINES } from '../../../contrib/positronAgentTerminal/common/agentTerminalService.js';
import * as extHostProtocol from './extHost.positron.protocol.js';

/** How long `runCommand` and `waitForCommand` wait by default, in milliseconds. */
const DEFAULT_WAIT_MS = 30_000;

export class ExtHostAgentTerminals {

	private readonly _proxy: extHostProtocol.MainThreadAgentTerminalShape;

	constructor(mainContext: extHostProtocol.IMainPositronContext) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadAgentTerminal);
	}

	async create(extensionId: string, options: positron.AgentTerminalOptions): Promise<positron.AgentTerminal> {
		return this._toApi(extensionId, await this._proxy.$createTerminal(extensionId, options));
	}

	async getAll(extensionId: string): Promise<positron.AgentTerminal[]> {
		const terminals = await this._proxy.$getTerminals(extensionId);
		return terminals.map(t => this._toApi(extensionId, t));
	}

	private _toApi(extensionId: string, terminal: IAgentTerminal): positron.AgentTerminal {
		const proxy = this._proxy;
		const id = terminal.id;
		return Object.freeze({
			id,
			name: terminal.name,
			runCommand: (commandLine: string, options?: { waitMs?: number }, token?: vscode.CancellationToken) =>
				proxy.$runCommand(extensionId, id, commandLine, options?.waitMs ?? DEFAULT_WAIT_MS, token ?? CancellationToken.None),
			waitForCommand: (commandId: string, options?: { waitMs?: number }, token?: vscode.CancellationToken) =>
				proxy.$waitForCommand(extensionId, id, commandId, options?.waitMs ?? DEFAULT_WAIT_MS, token ?? CancellationToken.None),
			readOutput: (commandId: string, options?: { offset?: number; limit?: number }) =>
				proxy.$readOutput(extensionId, id, commandId, options?.offset ?? 0, options?.limit ?? DEFAULT_READ_LINES),
			getStatus: () => proxy.$getStatus(extensionId, id),
			interrupt: () => proxy.$interrupt(extensionId, id),
			show: (preserveFocus?: boolean) => proxy.$show(extensionId, id, preserveFocus ?? false),
			dispose: () => proxy.$disposeTerminal(extensionId, id),
		});
	}
}
