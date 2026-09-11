/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';
import { McpTestClient, toolResultText } from './helpers/mcp-client';

test.use({
	suiteId: __filename,
	// The MCP server is off by default while the feature is experimental, and
	// the setting is read live, so it is written before the app starts.
	extraSettings: { 'ai.enabled': true, 'ai.mcp.enabled': true },
});

/**
 * Reads the endpoint and token Positron published for this window, by way of
 * the command that puts them on the clipboard. This is the same pair an agent
 * finds in an integrated terminal's environment.
 *
 * @param app The running application.
 * @returns A client bound to this window's MCP server.
 */
async function connectAgent(app: Application): Promise<McpTestClient> {
	await app.workbench.clipboard.clearClipboard();
	await app.workbench.quickaccess.runCommand('positron.mcp.copyConnectionDetails');

	let details = '';
	await expect(async () => {
		details = (await app.workbench.clipboard.getClipboardText()) ?? '';
		expect(details).toContain('POSITRON_MCP_URL');
	}, 'MCP connection details on the clipboard').toPass({ timeout: 30000 });

	const url = details.match(/POSITRON_MCP_URL=(\S+)/)?.[1];
	const token = details.match(/POSITRON_MCP_TOKEN=(\S+)/)?.[1];
	if (!url || !token) {
		throw new Error(`Could not read the MCP connection details: ${details}`);
	}

	const client = new McpTestClient(url, token, 'claude-code');
	await client.initialize();
	return client;
}

test.describe('MCP Server', {
	tag: [tags.WEB, tags.MCP, tags.CONSOLE, tags.SESSIONS]
}, () => {
	test('Python - Agent code runs in the session and is attributed in the console', async function ({ app, python }) {
		const agent = await connectAgent(app);

		expect(await agent.listTools()).toEqual(expect.arrayContaining([
			'list_sessions',
			'execute_code',
			'evaluate_code',
			'interrupt_session',
			'list_positron_commands',
			'run_positron_command',
		]));

		const sessions = await agent.callTool('list_sessions');
		expect(toolResultText(sessions)).toContain('python');

		const result = await agent.callTool('execute_code', {
			code: 'print("hello from the agent")',
		});
		expect(result.isError).not.toBe(true);
		expect(toolResultText(result)).toContain('hello from the agent');

		// The user sees what the agent ran, labelled with who ran it, followed
		// by its output.
		await app.workbench.console.waitForConsoleContents('print("hello from the agent")');
		await app.workbench.console.waitForConsoleContents('hello from the agent');
		await expect(app.code.driver.currentPage.locator('.activity-input .attribution'))
			.toContainText('claude-code');
	});

	test('Python - Silent evaluation returns a value to the agent', async function ({ app, python }) {
		const agent = await connectAgent(app);

		const result = await agent.callTool('evaluate_code', { code: '6 * 7' });

		expect(result.isError).not.toBe(true);
		expect(toolResultText(result)).toContain('42');
	});

	test('R - Agent code runs in an R session', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const agent = await connectAgent(app);

		const result = await agent.callTool('execute_code', { code: 'cat("hello from R\\n")' });

		expect(result.isError).not.toBe(true);
		expect(toolResultText(result)).toContain('hello from R');
		await app.workbench.console.waitForConsoleContents('hello from R');
	});

	test('Positron commands are searchable and runnable', async function ({ app, python }) {
		const agent = await connectAgent(app);

		const commands = await agent.callTool('list_positron_commands', { query: 'plots' });
		expect(commands.isError).not.toBe(true);
		expect(toolResultText(commands)).toContain('workbench.panel.positronPlots.focus');

		const focused = await agent.callTool('run_positron_command', {
			command_id: 'workbench.panel.positronPlots.focus',
		});
		expect(focused.isError).not.toBe(true);
		await expect(app.code.driver.currentPage.locator('.positron-plots-container'))
			.toBeVisible();
	});

	test('A request without a valid token is refused', async function ({ app, python }) {
		const agent = await connectAgent(app);
		// Reach the same endpoint the real client is using, with a token that
		// was never issued.
		const url = ((await app.workbench.clipboard.getClipboardText()) ?? '')
			.match(/POSITRON_MCP_URL=(\S+)/)?.[1];
		expect(url).toBeTruthy();

		const impostor = new McpTestClient(url!, 'f'.repeat(64));

		await expect(impostor.initialize()).rejects.toThrow(/401/);
		// The real client is unaffected.
		expect(await agent.listTools()).toContain('execute_code');
	});
});
