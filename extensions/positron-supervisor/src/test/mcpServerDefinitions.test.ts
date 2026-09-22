/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpConnection } from '../mcpConnection';
import { McpConnectionSource, McpServerDefinitions } from '../McpServerDefinitions';

/** A registration standing in for one the supervisor issued. */
function connection(token: string): McpConnection {
	return {
		workspaceId: 'demo-1',
		displayName: 'demo',
		port: 39000,
		token,
		url: 'http://127.0.0.1:39000/mcp/w/demo-1',
		folders: [],
	};
}

/** Stands in for the frontend, so a test can move the registration by hand. */
class FakeSource implements McpConnectionSource {
	connection: McpConnection | undefined;
	private readonly _emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeConnection = this._emitter.event;

	set(value: McpConnection | undefined): void {
		this.connection = value;
		this._emitter.fire();
	}
}

/** What the provider reported, in a shape a test can compare in one go. */
function summarize(servers: vscode.McpHttpServerDefinition[]) {
	return servers.map(server => ({
		label: server.label,
		uri: server.uri.toString(),
		headers: server.headers,
	}));
}

suite('McpServerDefinitions', () => {
	test('offers nothing until the workspace is registered', () => {
		const source = new FakeSource();
		const definitions = new McpServerDefinitions(source);

		assert.deepStrictEqual(summarize(definitions.provideMcpServerDefinitions()), []);
	});

	test('offers the endpoint without its token', () => {
		const source = new FakeSource();
		source.set(connection('secret'));
		const definitions = new McpServerDefinitions(source);

		assert.deepStrictEqual(summarize(definitions.provideMcpServerDefinitions()), [{
			label: 'positron',
			uri: 'http://127.0.0.1:39000/mcp/w/demo-1',
			headers: {},
		}]);
	});

	test('hands over the current token at launch', () => {
		const source = new FakeSource();
		source.set(connection('first'));
		const definitions = new McpServerDefinitions(source);
		const [server] = definitions.provideMcpServerDefinitions();

		// The token rotates when the supervisor restarts, so what is resolved
		// is the registration we hold now, not the one that was provided.
		source.set(connection('second'));

		assert.deepStrictEqual(summarize([definitions.resolveMcpServerDefinition(server)!]), [{
			label: 'positron',
			uri: 'http://127.0.0.1:39000/mcp/w/demo-1',
			headers: { Authorization: 'Bearer second' },
		}]);
	});

	test('refuses to launch once the feature is off', () => {
		const source = new FakeSource();
		source.set(connection('secret'));
		const definitions = new McpServerDefinitions(source);
		const [server] = definitions.provideMcpServerDefinitions();

		source.set(undefined);

		assert.strictEqual(definitions.resolveMcpServerDefinition(server), undefined);
	});

	test('tells the editor when the registration changes', () => {
		const source = new FakeSource();
		const definitions = new McpServerDefinitions(source);
		let changes = 0;
		definitions.onDidChangeMcpServerDefinitions(() => changes++);

		source.set(connection('secret'));
		source.set(undefined);

		assert.strictEqual(changes, 2);
	});
});
