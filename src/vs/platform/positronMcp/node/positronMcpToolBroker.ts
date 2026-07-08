/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IPCServer } from '../../../base/parts/ipc/common/ipc.js';
import { IMcpCallerContext, PositronMcpToolBrokerChannelName } from '../common/positronMcp.js';
import { IMcpCallToolResult } from '../common/positronMcpTools.js';

/**
 * Routes MCP tool calls from one window's server to that window's renderer,
 * where the tools actually run against the workbench services.
 *
 * A broker instance is permanently bound to one window -- it is created
 * alongside that window's {@link PositronMcpWindowServer} -- so there is no
 * window selection to get right or wrong: every call this broker makes always
 * targets the same window. Liveness is kept behind this interface so the
 * server and session never touch the Electron windows service directly, which
 * keeps them in the node layer and unit-testable with a fake broker.
 */
export interface IPositronMcpToolBroker {
	/** The window this broker's calls always target. */
	readonly windowId: number;

	/** Whether this window's renderer is currently connected. */
	isConnected(): boolean;

	/**
	 * Invoke a tool in this broker's window and return its MCP result. The
	 * caller context identifies which agent's session is asking, so renderer-side
	 * consent and attribution can name it.
	 */
	invokeTool(name: string, args: Record<string, unknown>, caller: IMcpCallerContext): Promise<IMcpCallToolResult>;
}

/** The IPC context string a renderer registers under (see ElectronIPCMainProcessService). */
function windowContext(windowId: number): string {
	return `window:${windowId}`;
}

/**
 * {@link IPositronMcpToolBroker} backed by the main-process IPC server. Picks the
 * destination renderer by matching the connection context against this
 * broker's fixed window, then calls the renderer's tool-broker channel.
 */
export class PositronMcpToolBroker implements IPositronMcpToolBroker {
	constructor(
		private readonly _ipcServer: IPCServer<string>,
		readonly windowId: number,
	) { }

	isConnected(): boolean {
		const ctx = windowContext(this.windowId);
		return this._ipcServer.connections.some(connection => connection.ctx === ctx);
	}

	async invokeTool(name: string, args: Record<string, unknown>, caller: IMcpCallerContext): Promise<IMcpCallToolResult> {
		const ctx = windowContext(this.windowId);
		// Guard the wait-forever behavior of getChannel(filter): if no connection
		// matches, the underlying call would block until one appears. We only call
		// after confirming the target is connected, so the connection is found
		// synchronously and the call dispatches immediately. A disconnect mid-call
		// rejects the pending call rather than hanging.
		if (!this._ipcServer.connections.some(connection => connection.ctx === ctx)) {
			throw new Error(`Window ${this.windowId} is no longer connected`);
		}
		const channel: IChannel = this._ipcServer.getChannel(PositronMcpToolBrokerChannelName, connection => connection.ctx === ctx);
		return channel.call<IMcpCallToolResult>('callTool', { name, args, caller });
	}
}
