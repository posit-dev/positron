/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/modelProviderShared';

test.use({
	suiteId: __filename,
});

const POSIT_ASSISTANT_PROVIDERS: ModelProvider[] = ['anthropic-api'];

// Catches regressions where MCP servers in `.posit/assistant/settings.json`
// are ignored — see posit-dev/assistant#1289 (fixed in #1293). Uses the `echo`
// tool from @modelcontextprotocol/server-everything as a stable reference.
test.describe('Posit Assistant MCP', {
	tag: [tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	for (const provider of POSIT_ASSISTANT_PROVIDERS) {
		test.describe(provider, () => {
			let serverDir: string;

			test.beforeAll(async function ({ app, settings }) {
				// Install the server here and launch it with node rather than `npx`:
				// the first npx spawned from the extension host on a Windows runner
				// takes 19-26s, past the assistant's 10s MCP connect timeout, and a
				// runner-side npx pre-warm does not shorten it.
				serverDir = mkdtempSync(join(tmpdir(), 'mcp-everything-'));
				execSync('npm install --no-audit --no-fund @modelcontextprotocol/server-everything', {
					cwd: serverDir,
					stdio: 'ignore',
					timeout: 180000,
				});
				const serverEntry = join(serverDir, 'node_modules', '@modelcontextprotocol', 'server-everything', 'dist', 'index.js');

				// Write the settings file before activating the assistant so we
				// don't rely on the file watcher for the first MCP startup.
				const configDir = join(app.workspacePathOrFolder, '.posit', 'assistant');
				mkdirSync(configDir, { recursive: true });
				writeFileSync(
					join(configDir, 'settings.json'),
					JSON.stringify({ mcpServers: { everything: { command: [process.execPath, serverEntry] } } }, null, 2),
				);

				await app.workbench.modelProviderModal.loginModelProvider(provider);
				// Maximize the sidebar so the Posit Assistant webview is not
				// obscured by outer-page elements on small CI viewports.
				await app.workbench.quickaccess.runCommand('workbench.action.fullSizedSidebar');
				await app.workbench.positAssistant.checkForDevBuildUpdate(settings, app.workbench.quickaccess);
			});

			test.afterAll(async function ({ cleanup }) {
				// No logout: the `app` fixture is worker-scoped and tears down
				// after this spec finishes, so signing out adds no isolation - it
				// only adds flake surface.
				await cleanup.removeTestFolder('.posit/assistant');
				rmSync(serverDir, { recursive: true, force: true });
			});

			test(`${provider} - Use echo tool from MCP server configured in .posit/assistant/settings.json`, async function ({ app }) {
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
