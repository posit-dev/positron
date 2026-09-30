/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';
import { McpStdioClient, McpTestClient, toolResultText } from './helpers/mcp-client';

/** Where Positron writes Codex's configuration, in place of the user's own. */
const CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-codex-'));

test.use({
	suiteId: __filename,
	// The MCP server is off by default while the feature is experimental, and
	// the setting is read live, so it is written before the app starts.
	extraSettings: { 'ai.enabled': true, 'ai.mcp.enabled': true },
	extraEnv: { CODEX_HOME },
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

/**
 * Adds Positron to Codex's configuration the way a user does, and reads back
 * the command line it wrote.
 *
 * @param app The running application.
 * @returns The command and arguments Codex would start the server with.
 */
async function configureCodex(app: Application): Promise<{ command: string; args: string[] }> {
	await app.workbench.quickaccess.runCommand('positron.mcp.configureAgent', { keepOpen: true });
	await app.workbench.quickInput.waitForQuickInputOpened();
	await app.workbench.quickInput.type('Codex');
	await app.workbench.quickInput.selectQuickInputElementContaining('Codex');

	const configPath = path.join(CODEX_HOME, 'config.toml');
	let config = '';
	await expect(async () => {
		config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
		expect(config).toContain('mcp-stdio');
	}, 'Codex configured').toPass({ timeout: 15000 });

	// The values are written as JSON strings and arrays, which TOML shares.
	return {
		command: JSON.parse(config.match(/^command = (?<value>.+)$/m)!.groups!.value),
		args: JSON.parse(config.match(/^args = (?<value>.+)$/m)!.groups!.value),
	};
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
			'get_plot',
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
		await app.workbench.console.waitForConsoleContents('hello from the agent', { exact: true });
		await expect(app.code.driver.currentPage.locator('.activity-input .attribution'))
			.toContainText('Claude Code');
	});

	test('Python - The console is busy while agent code runs, and the agent can interrupt it', async function ({ app, python }) {
		const agent = await connectAgent(app);

		const running = agent.callTool('execute_code', {
			code: 'import time; time.sleep(30)',
			timeout_s: 60,
		});
		await app.workbench.console.waitForExecutionStarted();

		const interrupted = await agent.callTool('interrupt_session');
		expect(interrupted.isError).not.toBe(true);

		// The interrupted cell ends in an error, and the console goes idle.
		expect((await running).isError).toBe(true);
		await app.workbench.console.waitForExecutionComplete();
	});

	test('Python - An agent can look at the current plot', async function ({ app, python }) {
		const agent = await connectAgent(app);

		const drawn = await agent.callTool('execute_code', {
			code: 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()',
		});
		expect(drawn.isError).not.toBe(true);
		await app.workbench.plots.waitForCurrentPlot();

		const plot = await agent.callTool('get_plot');
		expect(plot.isError).not.toBe(true);
		expect(plot.content.find(block => block.type === 'image')?.mimeType).toMatch(/^image\//);
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
		// The agent targets the foreground session, which Positron reports as
		// the R console takes over from Python.
		await expect(async () => {
			const listed = await agent.callTool('list_sessions');
			const sessions = listed.structuredContent?.sessions as { language: string; is_foreground: boolean }[];
			expect(sessions.find(session => session.is_foreground)?.language).toBe('R');
		}, 'R session in the foreground').toPass({ timeout: 15000 });

		const result = await agent.callTool('execute_code', { code: 'cat("hello from R\\n")' });

		expect(result.isError).not.toBe(true);
		expect(toolResultText(result)).toContain('hello from R');
		await app.workbench.console.waitForConsoleContents('hello from R', { exact: true });
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

test.describe('MCP Server over stdio', {
	tag: [tags.MCP, tags.CONSOLE, tags.SESSIONS]
}, () => {
	test('Python - An agent Positron configured runs code over stdio', async function ({ app, python }) {
		// Wait for the workspace to be registered, which is what writes the
		// files the bridge finds it by.
		await connectAgent(app);
		const { command, args } = await configureCodex(app);

		// Without the variables a Positron terminal exports, the bridge has
		// to find the workspace from the directory the agent runs in.
		const env = { ...process.env };
		delete env.POSITRON_MCP_URL;
		delete env.POSITRON_MCP_TOKEN;
		const agent = new McpStdioClient(command, args, app.workspacePathOrFolder, env, 'codex');
		try {
			await agent.initialize();
			expect(await agent.listTools()).toContain('execute_code');

			const result = await agent.callTool('execute_code', {
				code: 'print("hello over stdio")',
			});
			expect(result.isError).not.toBe(true);
			expect(toolResultText(result)).toContain('hello over stdio');
			await app.workbench.console.waitForConsoleContents('hello over stdio', { exact: true });
		} finally {
			agent.close();
		}
	});
});
