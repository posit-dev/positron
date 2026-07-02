/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMcpCallerContext } from '../../../../platform/positronMcp/common/positronMcp.js';
import { IPositronMcpToolService } from '../browser/positronMcpToolService.js';

/**
 * Renderer-side channel the main-process MCP server calls into to run a tool in
 * this window. Registered on IMainProcessService so the server can pick this
 * window by its IPC connection context (the window-pinning target). Hand-written
 * rather than a ProxyChannel because the call shape is a single `callTool`.
 */
export class PositronMcpToolBrokerChannel implements IServerChannel<string> {
	constructor(private readonly _toolService: IPositronMcpToolService) { }

	listen<T>(_ctx: string, event: string): Event<T> {
		throw new Error(`[PositronMcpToolBrokerChannel] Event not found: ${event}`);
	}

	async call<T>(_ctx: string, command: string, arg?: unknown): Promise<T> {
		if (command === 'callTool') {
			const { name, args, caller } = (arg ?? {}) as { name?: string; args?: Record<string, unknown>; caller?: IMcpCallerContext };
			if (!name) {
				throw new Error('[PositronMcpToolBrokerChannel] callTool requires a tool name');
			}
			return this._toolService.callTool(name, args ?? {}, caller) as Promise<T>;
		}
		throw new Error(`[PositronMcpToolBrokerChannel] Call not found: ${command}`);
	}
}
