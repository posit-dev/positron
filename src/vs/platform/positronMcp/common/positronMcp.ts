/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IPositronMcpService = createDecorator<IPositronMcpService>('positronMcpService');

/** The default localhost port the MCP server listens on. */
export const POSITRON_MCP_DEFAULT_PORT = 43123;

/** Name of the main-process channel exposing {@link IPositronMcpService} to renderers. */
export const PositronMcpChannelName = 'positronMcp';

/**
 * Name of the renderer-registered channel the main-process server calls back
 * into to invoke a window's MCP tools. The server picks the destination window
 * by matching the IPC client context, so tool calls run in the renderer where
 * the runtime/notebook/editor services live.
 */
export const PositronMcpToolBrokerChannelName = 'positronMcpToolBroker';

/** A snapshot of the server's runtime state, for status UI. */
export interface IPositronMcpServerStatus {
	/** Whether the HTTP server is currently listening. */
	readonly running: boolean;
	/** The port the server listens on (or would, when started). */
	readonly port: number;
}

/**
 * Main-process service that owns the Positron MCP HTTP server.
 *
 * The server is a single long-lived listener on a fixed localhost port, shared
 * across all windows. Per-request routing to a specific window's renderer (where
 * the tools actually run) is handled internally via the tool-broker channel.
 *
 * The renderer drives the lifecycle (`start`/`stop`) because the enable flag is
 * a workbench setting the main process does not read directly.
 */
export interface IPositronMcpService {
	readonly _serviceBrand: undefined;

	/** Start the HTTP server if it is not already listening. Idempotent. */
	start(): Promise<void>;

	/** Stop the HTTP server if it is listening. Idempotent. */
	stop(): Promise<void>;

	/** Current server status. */
	getStatus(): Promise<IPositronMcpServerStatus>;
}
