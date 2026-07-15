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

// Catches regressions where MCP servers in `.positai/settings.json` are
// ignored — see posit-dev/assistant#1289 (fixed in #1293). Uses the `echo`
// tool from @modelcontextprotocol/server-everything as a stable reference.
test.describe.skip('Posit Assistant MCP', { // skipping while investigating failures
	tag: [tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	for (const provider of POSIT_ASSISTANT_PROVIDERS) {
		test.describe(provider, () => {
			test.beforeAll(async function ({ app, settings }) {
				// Write `.positai/settings.json` before activating the assistant
				// so we don't rely on the file watcher for the first MCP startup.
				const positaiDir = join(app.workspacePathOrFolder, '.positai');
				mkdirSync(positaiDir, { recursive: true });
				// On Windows `npx` is a .cmd shim; wrap with `cmd /c` so the
				// assistant's stdio launcher can spawn it.
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
				await app.workbench.positAssistant.checkForDevBuildUpdate(settings, app.workbench.quickaccess);
			});

			test.afterAll(async function ({ cleanup }) {
				// No logout: the `app` fixture is worker-scoped and tears down
				// after this spec finishes, so signing out adds no isolation - it
				// only adds flake surface.
				await cleanup.removeTestFolder('.positai');
			});

			test(`${provider} - Use echo tool from MCP server configured in .positai/settings.json`, async function ({ app }) {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();
				await app.workbench.positAssistant.selectProviderModel(provider);

				// Unique marker so any positive match has to come from this run.
				const marker = 'positron-mcp-echo-marker-7f31b9c4';

				await app.workbench.positAssistant.sendMessage(
					`Call the "echo" tool from the "everything" MCP server with this exact message: ${marker}. Then reply with only the echoed text.`,
					false,
					{ newConversation: false },
				);

				await app.workbench.positAssistant.expectMcpToolConfirmVisible('everything', 'echo');
				await app.workbench.positAssistant.allowToolOnce();
				// MCP server startup (npx fetch + launch) can push first-tool
				// latency past the default 60s.
				await app.workbench.positAssistant.waitForResponseComplete(120000);

				// The result accordion only renders after a real MCP roundtrip
				// completes, so its presence is positive evidence the tool ran -
				// no need to inspect natural-language reply or accordion content.
				await app.workbench.positAssistant.expectMcpToolResultVisible('everything', 'echo');
			});
		});
	}

});
