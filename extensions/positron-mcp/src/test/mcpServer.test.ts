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
			'notebook-run-cells', 'open-document', 'profile-data', 'session-interrupt',
			'session-restart', 'session-start',
		]);
	});

	test('every tool named in the server instructions exists', async () => {
		const init = await server.processRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' });
		const list = await server.processRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
		const toolNames: Set<string> = new Set(list.result.tools.map((t: { name: string }) => t.name));
		const instructions: string = init.result.instructions;
		// Tool names share these kebab prefixes; anchoring on them avoids matching
		// hyphenated prose (e.g. "next-generation") that isn't a tool.
		const referenced = instructions.match(/\b(?:get|session|notebook|execute|open|inspect|enlarge|profile)-[a-z-]+\b/g) ?? [];
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

	test('getStatus reports request count and the initialize client', async () => {
		await server.processRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'Claude Code', version: '1.2.3' } } });
		await server.processRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

		const status = server.getStatus();
		assert.deepStrictEqual(
			{ running: status.running, requestCount: status.requestCount, lastClient: status.lastClient, hasTimestamp: status.lastRequestAt instanceof Date },
			{ running: false, requestCount: 2, lastClient: { name: 'Claude Code', version: '1.2.3' }, hasTimestamp: true },
		);
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

suite('McpServer profile-data handler', () => {
	let server: McpServer;

	setup(() => { server = new McpServer(fakeExtensionContext()); });
	teardown(() => { server.dispose(); sinon.restore(); });

	function stubSession(): void {
		sinon.stub(positron.runtime, 'getForegroundSession').resolves(mock<positron.BaseLanguageRuntimeSession>({
			metadata: mock<positron.BaseLanguageRuntimeSession['metadata']>({ sessionId: 's1' }),
			runtimeMetadata: mock<positron.BaseLanguageRuntimeSession['runtimeMetadata']>({ languageName: 'Python' }),
		}));
	}

	function stubVariable(name: string): void {
		sinon.stub(positron.runtime, 'getSessionVariables').resolves([[
			mock<positron.RuntimeVariable>({ display_name: name, access_key: name }),
		]]);
	}

	// A canned querySessionTables result for a 3-column frame: a number, a string,
	// and a boolean, each carrying the per-column JSON the kernels emit.
	function sampleResult(): positron.QueryTableSummaryResult {
		return {
			num_rows: 3,
			num_columns: 3,
			column_schemas: [
				JSON.stringify({ column_name: 'age', type_display: 'number', column_index: 0, type_name: 'int64' }),
				JSON.stringify({ column_name: 'name', type_display: 'string', column_index: 1, type_name: 'object' }),
				JSON.stringify({ column_name: 'active', type_display: 'boolean', column_index: 2, type_name: 'bool' }),
			],
			column_profiles: [
				JSON.stringify({ column_name: 'age', type_display: 'number', summary_stats: { type_display: 'number', number_stats: { min_value: '1', max_value: '99', mean: '40.5', median: '38', stdev: '12.3' } } }),
				JSON.stringify({ column_name: 'name', type_display: 'string', summary_stats: { type_display: 'string', string_stats: { num_empty: 0, num_unique: 3 } } }),
				JSON.stringify({ column_name: 'active', type_display: 'boolean', summary_stats: { type_display: 'boolean', boolean_stats: { true_count: 2, false_count: 1 } } }),
			],
		};
	}

	function callProfileData(args: object = { name: 'df' }): Promise<{ result: { content: { text: string }[] } }> {
		return server.processRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'profile-data', arguments: args } }) as
			Promise<{ result: { content: { text: string }[] } }>;
	}

	test('formats per-column summary statistics by data type', async () => {
		stubSession();
		stubVariable('df');
		sinon.stub(positron.runtime, 'querySessionTables').resolves([sampleResult()]);

		assert.deepStrictEqual((await callProfileData()).result.content[0].text, [
			'Profile of "df" (3 rows x 3 columns):',
			'',
			'• age (number): min 1, max 99, mean 40.5, median 38, sd 12.3',
			'• name (string): 3 unique, 0 empty',
			'• active (boolean): 2 true, 1 false',
		].join('\n'));
	});

	test('shows a column without stats when the kernel skipped it (Python omits failed columns)', async () => {
		stubSession();
		stubVariable('df');
		const result = sampleResult();
		// Python drops a column from column_profiles when its stats throw, leaving
		// the profiles array shorter than and misaligned with column_schemas.
		result.column_profiles = [result.column_profiles[0], result.column_profiles[2]];
		sinon.stub(positron.runtime, 'querySessionTables').resolves([result]);

		assert.deepStrictEqual((await callProfileData()).result.content[0].text, [
			'Profile of "df" (3 rows x 3 columns):',
			'',
			'• age (number): min 1, max 99, mean 40.5, median 38, sd 12.3',
			'• name (string)',
			'• active (boolean): 2 true, 1 false',
		].join('\n'));
	});

	test('limits output to the requested columns', async () => {
		stubSession();
		stubVariable('df');
		sinon.stub(positron.runtime, 'querySessionTables').resolves([sampleResult()]);

		assert.deepStrictEqual((await callProfileData({ name: 'df', columns: ['age'] })).result.content[0].text, [
			'Profile of "df" (3 rows x 3 columns):',
			'',
			'• age (number): min 1, max 99, mean 40.5, median 38, sd 12.3',
		].join('\n'));
	});

	test('reports when the variable is not a table', async () => {
		stubSession();
		stubVariable('x');
		sinon.stub(positron.runtime, 'querySessionTables').rejects(new Error('Object is not a supported table type'));

		const text = (await callProfileData({ name: 'x' })).result.content[0].text;
		assert.match(text, /Could not profile "x"/);
		assert.match(text, /supported table type/);
	});

	test('reports when the variable does not exist', async () => {
		stubSession();
		sinon.stub(positron.runtime, 'getSessionVariables').resolves([[]]);
		assert.match((await callProfileData({ name: 'missing' })).result.content[0].text, /No variable named "missing"/);
	});

	test('reports when there is no active session', async () => {
		sinon.stub(positron.runtime, 'getForegroundSession').resolves(undefined);
		assert.match((await callProfileData()).result.content[0].text, /No active runtime session/);
	});

	test('times out instead of hanging when the kernel is busy', async () => {
		stubSession();
		stubVariable('df');
		sinon.stub(positron.runtime, 'querySessionTables').returns(
			new Promise<positron.QueryTableSummaryResult[]>(() => { /* never resolves */ }));
		const clock = sinon.useFakeTimers();

		const pending = callProfileData();
		await clock.tickAsync(30000);

		assert.match((await pending).result.content[0].text, /timed out/);
	});
});
