/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

/**
 * Test suite for verifying that assistant tools are correctly scoped to active sessions.
 * Tools with 'requires-session:r' should only be available when an R session is active.
 * Tools with 'requires-session:python' should only be available when a Python session is active.
 * @see https://github.com/posit-dev/positron/issues/11616
 */
test.describe('Positron Assistant Tool Scoping', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {

	// R-specific tools that should only be enabled when R session is active
	const R_SPECIFIC_TOOLS = [
		'getPackageVignette',
		'listAvailableVignettes',
		'getHelpPage'
	];

	// Python-specific tools that should only be enabled when Python session is active
	const PYTHON_SPECIFIC_TOOLS = [
		'installPythonPackage'
	];

	test.beforeAll('Sign in to Assistant', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('echo');
	});

	test.beforeEach('Clean up sessions', async function ({ app }) {
		// Delete all sessions to ensure clean state for each test
		await app.workbench.sessions.deleteAll();
	});

	test.afterAll('Sign out of Assistant', async function ({ app }) {
		await expect(async () => {
			await app.workbench.assistant.logoutModelProvider('echo');
		}).toPass({ timeout: 30000 });
	});

	/**
	 * Verifies that R-specific tools are excluded when only a Python session is active.
	 * When the user has only a Python session running, tools like getPackageVignette,
	 * listAvailableVignettes, and getHelpPage (which require an R session) should not
	 * be available to the assistant.
	 */
	test('R-specific tools are excluded when only Python session is active', async function ({ app, sessions }) {
		// Start only a Python session (reuse: false ensures fresh session)
		await sessions.start('python', { reuse: false });

		await test.step('Send message and verify R tools are not available', async () => {
			await app.workbench.assistant.clickNewChatButton();
			await app.workbench.assistant.selectChatMode('Agent');

			// Send a simple message to get the available tools
			await app.workbench.assistant.enterChatMessage('Hello', true);

			const availableTools = await app.workbench.assistant.getAvailableTools(app.workspacePathOrFolder);

			// Verify that no R-specific tools are available
			for (const tool of R_SPECIFIC_TOOLS) {
				expect(availableTools, `R-specific tool '${tool}' should not be available when only Python session is active`).not.toContain(tool);
			}

			// Verify that Python-specific tools ARE available
			for (const tool of PYTHON_SPECIFIC_TOOLS) {
				expect(availableTools, `Python-specific tool '${tool}' should be available when Python session is active`).toContain(tool);
			}
		});
	});

	/**
	 * Verifies that Python-specific tools are excluded when only an R session is active.
	 * When the user has only an R session running, tools like installPythonPackage
	 * (which require a Python session) should not be available to the assistant.
	 */
	test('Python-specific tools are excluded when only R session is active', async function ({ app, sessions }) {
		// Start only an R session (reuse: false ensures fresh session)
		await sessions.start('r', { reuse: false });

		await test.step('Send message and verify Python tools are not available', async () => {
			await app.workbench.assistant.clickNewChatButton();
			await app.workbench.assistant.selectChatMode('Agent');

			// Send a simple message to get the available tools
			await app.workbench.assistant.enterChatMessage('Hello', true);

			const availableTools = await app.workbench.assistant.getAvailableTools(app.workspacePathOrFolder);

			// Verify that no Python-specific tools are available
			for (const tool of PYTHON_SPECIFIC_TOOLS) {
				expect(availableTools, `Python-specific tool '${tool}' should not be available when only R session is active`).not.toContain(tool);
			}

			// Verify that R-specific tools ARE available
			for (const tool of R_SPECIFIC_TOOLS) {
				expect(availableTools, `R-specific tool '${tool}' should be available when R session is active`).toContain(tool);
			}
		});
	});

	/**
	 * Verifies that non-session-specific tools are available when a session is active.
	 * This includes:
	 * - Generic session tools (requires-session without language specifier): executeCode, getPlot, etc.
	 * - Non-session tools (always available): documentCreate, getProjectTree, etc.
	 */
	test('Non-session-specific tools are available when any session is active', async function ({ app, sessions }) {
		// Generic session tools that require any session (not language-specific)
		const GENERIC_SESSION_TOOLS = [
			'executeCode',
			'getPlot'
		];

		// Tools that don't require any session (always available in Agent mode)
		const NON_SESSION_TOOLS = [
			'documentCreate',
			'getProjectTree',
			'getChangedFiles',
			'configure_notebook',
			'notebook_list_packages',
			'notebook_install_packages',
			'inline_chat_exit',
			'get_terminal_output',
			'terminal_selection',
			'terminal_last_command',
			'run_task',
			'get_task_output',
			'create_and_run_task',
			'run_in_terminal',
			'manage_todo_list',
			'runSubagent',
			'positron_findTextInProject_internal',
			'positron_getFileContents_internal',
			'positron_editFile_internal',
			'runTests'
		];

		// Start only a Python session
		await sessions.start('python', { reuse: false });

		await test.step('Verify non-session-specific tools are available', async () => {
			await app.workbench.assistant.clickNewChatButton();
			await app.workbench.assistant.selectChatMode('Agent');

			await app.workbench.assistant.enterChatMessage('Hello', true);

			const availableTools = await app.workbench.assistant.getAvailableTools(app.workspacePathOrFolder);

			// Verify that generic session tools ARE available
			for (const tool of GENERIC_SESSION_TOOLS) {
				expect(availableTools, `Generic session tool '${tool}' should be available when any session is active`).toContain(tool);
			}

			// Verify that non-session tools ARE available
			for (const tool of NON_SESSION_TOOLS) {
				expect(availableTools, `Non-session tool '${tool}' should be available`).toContain(tool);
			}
		});
	});
});
