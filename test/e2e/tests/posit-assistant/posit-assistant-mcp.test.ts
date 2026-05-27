/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/positronAssistant';

test.use({
	suiteId: __filename
});

const POSIT_ASSISTANT_PROVIDERS: ModelProvider[] = ['anthropic-api'];

// Posit Assistant reads MCP server configuration from `.positai/settings.json`
// in the workspace root. This test catches regressions of the class of bug
// reported in posit-dev/assistant#1289 (fixed in posit-dev/assistant#1293),
// where MCP servers configured in .positai/settings.json were ignored.
//
// We use the upstream MCP reference server "@modelcontextprotocol/server-everything"
// for its stable `echo` tool, which simply returns the input message.
test.describe('Posit Assistant MCP', {
	tag: [tags.POSIT_ASSISTANT, tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	for (const provider of POSIT_ASSISTANT_PROVIDERS) {
		test.describe(provider, () => {
			test.beforeAll(async function ({ app, settings }) {
				// Write the MCP server config into the workspace .positai/settings.json
				// BEFORE activating Posit Assistant. The fix watches this file, but
				// writing it up-front avoids relying on watcher timing for the first
				// MCP startup.
				const positaiDir = join(app.workspacePathOrFolder, '.positai');
				mkdirSync(positaiDir, { recursive: true });
				// `npx` on Windows is a .cmd shim; spawning it directly from the
				// assistant's stdio launcher fails, so wrap with `cmd /c`.
				const command = process.platform === 'win32'
					? ['cmd', '/c', 'npx', '-y', '@modelcontextprotocol/server-everything']
					: ['npx', '-y', '@modelcontextprotocol/server-everything'];
				writeFileSync(
					join(positaiDir, 'settings.json'),
					JSON.stringify({ mcpServers: { everything: { command } } }, null, 2),
				);

				await app.workbench.assistant.loginModelProvider(provider);
				// Maximize the sidebar so the Posit Assistant webview is not
				// obscured by outer-page elements on small CI viewports.
				await app.workbench.quickaccess.runCommand('workbench.action.fullSizedSidebar');
				// Ensure we're running the latest Posit Assistant dev build, which
				// contains the MCP-from-.positai fix.
				await app.workbench.positAssistant.checkForDevBuildUpdate(settings, app.workbench.quickaccess);
			});

			test.afterAll(async function ({ app, cleanup }) {
				await app.workbench.assistant.logoutModelProvider(provider);
				await cleanup.removeTestFolder('.positai');
			});

			test(`${provider} - Use echo tool from MCP server configured in .positai/settings.json`, async function ({ app }) {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				// A unique marker the LLM can't have produced from priors. If the
				// echo tool is reachable, this string round-trips through the MCP
				// server and surfaces in the response.
				const marker = 'positron-mcp-echo-marker-7f31b9c4';

				await app.workbench.positAssistant.sendMessage(
					`Call the "echo" tool from the "everything" MCP server with this exact message: ${marker}. Then reply with only the echoed text.`,
					false,
					{ newConversation: true },
				);

				// MCP tool calls go through the same allow/decline confirmation flow
				// as built-in tools. If MCP wasn't loaded from .positai/settings.json,
				// the model has no tool to call and this assertion will time out.
				await app.workbench.positAssistant.expectToolConfirmVisible();
				await app.workbench.positAssistant.allowToolOnce();
				// MCP server startup (npx fetch + launch) can push first-tool latency
				// past the default 60s. Give it more headroom.
				await app.workbench.positAssistant.waitForResponseComplete(120000);

				const responseText = await app.workbench.positAssistant.getLastResponseText();
				test.expect(responseText).toContain(marker);
			});
		});
	}

});
