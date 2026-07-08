/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Environment variables advertising this window's MCP server to processes
 * launched from the integrated terminal (e.g. the Claude Code stdio proxy,
 * which reports zero tools when they are absent). The names are the contract
 * with the proxy; keep them in sync with `extensions/positron-mcp-proxy`.
 */
export const POSITRON_MCP_URL_VAR = 'POSITRON_MCP_URL';
export const POSITRON_MCP_TOKEN_VAR = 'POSITRON_MCP_TOKEN';

export const IPositronMcpTerminalEnvironment = createDecorator<IPositronMcpTerminalEnvironment>('positronMcpTerminalEnvironment');

/** Where a window's MCP server is listening and the token requests must carry. */
export interface IPositronMcpServerEndpoint {
	readonly url: string;
	readonly token: string;
}

/**
 * Hands the integrated terminal the environment variables that point
 * terminal-launched agents at this window's MCP server.
 *
 * A single mutable implementation registered from this common file doubles as
 * the null object: the terminal reads it on every launch, and only the
 * desktop MCP lifecycle contribution ever pushes an endpoint into it, so in
 * web (or with MCP disabled) `getTerminalEnv()` stays `undefined` and the
 * terminal injects nothing. Terminals capture their environment at launch;
 * changes here apply to terminals created (or relaunched) afterwards.
 */
export interface IPositronMcpTerminalEnvironment {
	readonly _serviceBrand: undefined;

	/** Variables to inject into new integrated terminals, or `undefined` when the server is off. */
	getTerminalEnv(): Readonly<Record<string, string>> | undefined;

	/** Advertise a running server's endpoint, or `undefined` to stop advertising one. */
	setServer(endpoint: IPositronMcpServerEndpoint | undefined): void;
}

export class PositronMcpTerminalEnvironmentService implements IPositronMcpTerminalEnvironment {
	declare readonly _serviceBrand: undefined;

	private _env: Readonly<Record<string, string>> | undefined;

	getTerminalEnv(): Readonly<Record<string, string>> | undefined {
		return this._env;
	}

	setServer(endpoint: IPositronMcpServerEndpoint | undefined): void {
		this._env = endpoint && {
			[POSITRON_MCP_URL_VAR]: endpoint.url,
			[POSITRON_MCP_TOKEN_VAR]: endpoint.token,
		};
	}
}

registerSingleton(IPositronMcpTerminalEnvironment, PositronMcpTerminalEnvironmentService, InstantiationType.Delayed);
