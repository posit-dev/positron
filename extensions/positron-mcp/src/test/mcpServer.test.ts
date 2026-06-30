/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { McpServer } from '../mcpServer';
import { fakeExtensionContext, mock } from './testUtils';

// Drive the server's JSON-RPC dispatch (processRequest) directly, with positron
// stubbed. No socket, no live kernel -- fast and deterministic.
suite('McpServer protocol', () => {
	let server: McpServer;

	setup(() => { server = new McpServer(fakeExtensionContext()); });
	teardown(() => { server.dispose(); sinon.restore(); });

	test('initialize returns protocol metadata and instructions', async () => {
		const res = await server.processRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' });
		assert.strictEqual(res.result.serverInfo.name, 'positron-mcp-server');
		assert.ok(res.result.protocolVersion, 'protocolVersion is set');
		assert.ok(res.result.capabilities.tools, 'advertises the tools capability');
		assert.ok(res.result.instructions.length > 0, 'ships non-empty instructions');
	});

	test('tools/list exposes the expected tool set', async () => {
		const res = await server.processRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
		const names = res.result.tools.map((t: { name: string }) => t.name).sort();
		assert.deepStrictEqual(names, [
			'enlarge-plots-pane', 'execute-code', 'get-active-document', 'get-diagnostics',
			'get-packages', 'get-plot', 'get-session', 'get-variables', 'get-workspace-info',
			'inspect-variable', 'notebook-create', 'notebook-edit', 'notebook-read',
			'notebook-run-cells', 'open-document', 'session-interrupt', 'session-restart',
			'session-start',
		]);
	});

	test('every tool named in the server instructions exists', async () => {
		const init = await server.processRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' });
		const list = await server.processRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
		const toolNames: Set<string> = new Set(list.result.tools.map((t: { name: string }) => t.name));
		const instructions: string = init.result.instructions;
		// Tool names share these kebab prefixes; anchoring on them avoids matching
		// hyphenated prose (e.g. "next-generation") that isn't a tool.
		const referenced = instructions.match(/\b(?:get|session|notebook|execute|open|inspect|enlarge)-[a-z-]+\b/g) ?? [];
		assert.ok(referenced.length > 0, 'sanity: instructions reference some tools');
		for (const name of referenced) {
			assert.ok(toolNames.has(name), `instructions reference unknown tool "${name}"`);
		}
	});

	test('an unknown method returns -32601', async () => {
		const res = await server.processRequest({ jsonrpc: '2.0', id: 1, method: 'no/such/method' });
		assert.strictEqual(res.error?.code, -32601);
	});

	test('tools/call with an unknown tool returns -32601', async () => {
		const res = await server.processRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'no-such-tool' } });
		assert.strictEqual(res.error?.code, -32601);
	});
});

suite('McpServer get-packages handler', () => {
	let server: McpServer;

	setup(() => { server = new McpServer(fakeExtensionContext()); });
	teardown(() => { server.dispose(); sinon.restore(); });

	function stubForegroundSession(): void {
		sinon.stub(positron.runtime, 'getForegroundSession').resolves(mock<positron.BaseLanguageRuntimeSession>({
			metadata: mock<positron.BaseLanguageRuntimeSession['metadata']>({ sessionId: 's1' }),
			runtimeMetadata: mock<positron.BaseLanguageRuntimeSession['runtimeMetadata']>({ languageName: 'Python' }),
		}));
	}

	function callGetPackages(): Promise<{ result: { content: { text: string }[] } }> {
		return server.processRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get-packages' } }) as
			Promise<{ result: { content: { text: string }[] } }>;
	}

	test('formats installed packages with attached/outdated flags, sorted', async () => {
		stubForegroundSession();
		sinon.stub(positron.runtime, 'getSessionPackages').resolves([
			mock<positron.LanguageRuntimePackage>({ name: 'pandas', version: '2.1.0', attached: true }),
			mock<positron.LanguageRuntimePackage>({ name: 'requests', version: '2.31.0', outdated: true, latestVersion: '2.32.0' }),
			mock<positron.LanguageRuntimePackage>({ name: 'numpy', version: '1.26.0' }),
		]);

		const text = (await callGetPackages()).result.content[0].text;
		assert.match(text, /3 packages installed in your Python session/);
		assert.match(text, /pandas 2\.1\.0 \(attached\)/);
		assert.match(text, /requests 2\.31\.0 \(outdated -> 2\.32\.0\)/);
		assert.ok(text.indexOf('numpy') < text.indexOf('pandas'), 'packages are sorted alphabetically');
	});

	test('reports when no packages are installed', async () => {
		stubForegroundSession();
		sinon.stub(positron.runtime, 'getSessionPackages').resolves([]);
		assert.match((await callGetPackages()).result.content[0].text, /No packages reported/);
	});

	test('reports when there is no active session', async () => {
		sinon.stub(positron.runtime, 'getForegroundSession').resolves(undefined);
		assert.match((await callGetPackages()).result.content[0].text, /No active runtime session/);
	});

	test('times out instead of hanging when the kernel is busy', async () => {
		stubForegroundSession();
		// Never resolves: simulates the package query queued behind a running
		// computation on the single-threaded kernel (the bug this guards against).
		sinon.stub(positron.runtime, 'getSessionPackages').returns(
			new Promise<positron.LanguageRuntimePackage[]>(() => { /* never resolves */ }));
		const clock = sinon.useFakeTimers();

		const pending = callGetPackages();
		await clock.tickAsync(30000);

		assert.match((await pending).result.content[0].text, /busy/);
	});
});
