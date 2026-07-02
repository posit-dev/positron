/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IPCServer } from '../../../base/parts/ipc/common/ipc.js';
import { IMcpCallerContext, PositronMcpToolBrokerChannelName } from '../common/positronMcp.js';
import { IMcpCallToolResult } from '../common/positronMcpTools.js';

/**
 * Routes MCP tool calls from the main-process server to a specific window's
 * renderer, where the tools actually run against the workbench services.
 *
 * Window selection and liveness are kept behind this interface so the server
 * and session never touch the Electron windows service directly, which keeps
 * them in the node layer and unit-testable with a fake broker.
 */
export interface IPositronMcpToolBroker {
	/**
	 * The window an MCP session should pin to, or `undefined` when no suitable
	 * window exists. A session resolves this once at initialize and re-resolves
	 * only if the pinned window closes.
	 */
	resolveTargetWindow(): number | undefined;

	/** Whether the given window's renderer is currently connected. */
	isWindowConnected(windowId: number): boolean;

	/**
	 * Invoke a tool in the given window's renderer and return its MCP result. The
	 * caller context identifies which agent's session is asking, so renderer-side
	 * consent and attribution can name it.
	 */
	invokeTool(windowId: number, name: string, args: Record<string, unknown>, caller: IMcpCallerContext): Promise<IMcpCallToolResult>;
}

/** The IPC context string a renderer registers under (see ElectronIPCMainProcessService). */
function windowContext(windowId: number): string {
	return `window:${windowId}`;
}

/**
 * {@link IPositronMcpToolBroker} backed by the main-process IPC server. Picks the
 * destination renderer by matching the connection context against the target
 * window, then calls the renderer's tool-broker channel.
 *
 * The window selector resolves the last-active Positron window at call time; it
 * is injected (rather than depending on the windows service) so this stays in
 * the node layer and is testable.
 */
export class PositronMcpToolBroker implements IPositronMcpToolBroker {
	constructor(
		private readonly _ipcServer: IPCServer<string>,
		private readonly _windowSelector: () => number | undefined,
	) { }

	resolveTargetWindow(): number | undefined {
		return this._windowSelector();
	}

	isWindowConnected(windowId: number): boolean {
		const ctx = windowContext(windowId);
		return this._ipcServer.connections.some(connection => connection.ctx === ctx);
	}

	async invokeTool(windowId: number, name: string, args: Record<string, unknown>, caller: IMcpCallerContext): Promise<IMcpCallToolResult> {
		const ctx = windowContext(windowId);
		// Guard the wait-forever behavior of getChannel(filter): if no connection
		// matches, the underlying call would block until one appears. We only call
		// after confirming the target is connected, so the connection is found
		// synchronously and the call dispatches immediately. A disconnect mid-call
		// rejects the pending call rather than hanging.
		if (!this._ipcServer.connections.some(connection => connection.ctx === ctx)) {
			throw new Error(`Target window ${windowId} is no longer connected`);
		}
		const channel: IChannel = this._ipcServer.getChannel(PositronMcpToolBrokerChannelName, connection => connection.ctx === ctx);
		return channel.call<IMcpCallToolResult>('callTool', { name, args, caller });
	}
}
