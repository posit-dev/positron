/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { MCP_SERVER_NAME, McpConnection } from './mcpConnection';

/**
 * The ID of the server collection. Must match the
 * `contributes.mcpServerDefinitionProviders` entry in `package.json`, or
 * registration throws.
 */
export const MCP_DEFINITION_PROVIDER_ID = 'positron-sessions';

/** The slice of the MCP frontend the provider follows. */
export interface McpConnectionSource {
	readonly connection: McpConnection | undefined;
	readonly onDidChangeConnection: vscode.Event<void>;
}

/**
 * Publishes this workspace's MCP endpoint to the editor, so that chat
 * extensions running in this window reach its sessions with no configuration
 * file at all.
 *
 * The external harnesses are configured by writing the endpoint into a file
 * each of them reads; anything hosted by the editor is configured by this
 * instead, which is both less work and a good deal safer. The endpoint
 * moves with the supervisor and the token is minted per registration, so a file
 * would be stale as soon as it is written -- and `resolveMcpServerDefinition`
 * is called at launch, which lets the token be handed over then rather than
 * stored anywhere.
 */
export class McpServerDefinitions
	implements vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>, vscode.Disposable {

	private readonly _onDidChangeMcpServerDefinitions = new vscode.EventEmitter<void>();

	public readonly onDidChangeMcpServerDefinitions: vscode.Event<void> =
		this._onDidChangeMcpServerDefinitions.event;

	private readonly _disposables: vscode.Disposable[] = [];

	/**
	 * @param _source The frontend holding the registration, watched so the
	 *  editor is told when the endpoint appears, moves, or goes away.
	 */
	constructor(private readonly _source: McpConnectionSource) {
		this._disposables.push(_source.onDidChangeConnection(
			() => this._onDidChangeMcpServerDefinitions.fire()));
	}

	/**
	 * The server, while this window has one. Called eagerly, including before
	 * the supervisor is up, so an empty list here means "not yet" as often as
	 * it means "turned off"; either way the change event brings the editor back.
	 *
	 * @returns The server definition, without its token.
	 */
	public provideMcpServerDefinitions(): vscode.McpHttpServerDefinition[] {
		const connection = this._source.connection;
		if (!connection) {
			return [];
		}
		// No headers: what is returned here is cached by the editor, and the
		// token does not belong anywhere it can outlive the registration.
		return [new vscode.McpHttpServerDefinition(
			MCP_SERVER_NAME, vscode.Uri.parse(connection.url))];
	}

	/**
	 * Fill in the endpoint and token as the editor starts the server.
	 *
	 * The registration is read again rather than trusting the definition we are
	 * handed, which may have been cached from a window whose endpoint is gone.
	 *
	 * @param server The definition to resolve.
	 * @returns The resolved definition, or undefined when the feature has been
	 *  turned off since it was provided.
	 */
	public resolveMcpServerDefinition(
		server: vscode.McpHttpServerDefinition,
	): vscode.McpHttpServerDefinition | undefined {
		const connection = this._source.connection;
		if (!connection) {
			return undefined;
		}
		server.uri = vscode.Uri.parse(connection.url);
		server.headers = { Authorization: `Bearer ${connection.token}` };
		return server;
	}

	public dispose() {
		this._onDidChangeMcpServerDefinitions.dispose();
		this._disposables.forEach(disposable => disposable.dispose());
		this._disposables.length = 0;
	}
}
