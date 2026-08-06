/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Posit Assistant sign-in coverage on Posit Workbench.
 *
 * The desktop equivalent lives in `tests/posit-assistant/posit-assistant-signin.test.ts`.
 * Running the same flow on Workbench is not redundant: the provider catalog, the
 * credential store, and the egress to the model all live in the container's
 * server-side extension host, so this covers ground a desktop (or Electron) run
 * cannot reach -- the same class of gap that hid a missing `ai-config` module on
 * the remote-SSH server until a sign-in test ran there (posit-dev/positron#15306).
 *
 * Microsoft Foundry is deliberately absent: on Workbench it authenticates through
 * Azure managed credentials rather than an interactive sign-in, and that path is
 * covered by `posit-assistant-foundry.test.ts` on the Azure shard.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, tags } from '../../_test.setup';
import { ModelProvider } from '../../../pages/modelProviderAuth';

test.use({
	suiteId: __filename
});

const SIGNIN_PROVIDERS: ModelProvider[] = ['anthropic-api', 'openai-api', 'posit-ai'];

// Pins the reply to a single known word so the response assertion can check for
// it. A bare "Say hello" leaves the model free to answer with a greeting that
// never contains the word.
const HELLO_PROMPT = 'Reply with only the word hello.';

const CONTAINER_NAME = 'test';

// The session user's provider catalog. The default Workbench shard runs the
// session as user1 (only the Azure shard uses a JIT user), so `~` is /home/user1.
const AI_CONFIG_DIR = '/home/user1/.posit/ai';
const PROVIDERS_CONFIG_PATH = `${AI_CONFIG_DIR}/providers.json`;
const PROVIDERS_CONFIG_BACKUP_PATH = `${PROVIDERS_CONFIG_PATH}.signin-test.bak`;

/**
 * Enables Posit AI in the catalog. On Workbench the authentication extension
 * disables Posit AI on first activation so admins control AI access, by writing
 * `providers.positai.enabled: false` here (see `applyPwbPositAIDefault` in
 * extensions/authentication/src/pwbDefaults.ts). Core drops disabled providers
 * before the Configure Providers modal renders, so with that default in place the
 * Posit AI tile is absent entirely and there is nothing for the sign-in to click.
 *
 * The catalog ranks this file above the legacy
 * `positron.assistant.provider.positAI.enable` setting the e2e fixtures write, so
 * the setting cannot undo the default -- the file has to say so, which is exactly
 * what an admin turning Posit AI on for Workbench does.
 */
const PROVIDERS_CONFIG_JSON = JSON.stringify({
	version: 1,
	providers: { positai: { enabled: true } },
}, null, 2);

test.describe('Posit Assistant Sign-in - Workbench', {
	tag: [tags.WORKBENCH, tags.ASSISTANT],
}, () => {

	test.beforeAll('Enable the Posit AI provider in the session catalog', async function ({ app, runDockerCommand }) {
		// Write on the host then `docker cp` in, rather than heredoc-ing JSON through
		// nested shell quoting.
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-providers-'));
		const tmpProviders = path.join(tmpDir, 'providers.json');
		await fs.promises.writeFile(tmpProviders, PROVIDERS_CONFIG_JSON);

		try {
			await runDockerCommand(
				`docker exec ${CONTAINER_NAME} mkdir -p ${AI_CONFIG_DIR}`,
				'Create the AI config directory'
			);
			// Back up the catalog the extension wrote on activation so teardown can put
			// the container back the way the next suite expects to find it.
			await runDockerCommand(
				`docker exec ${CONTAINER_NAME} bash -lc 'if [ -f ${PROVIDERS_CONFIG_PATH} ]; then cp ${PROVIDERS_CONFIG_PATH} ${PROVIDERS_CONFIG_BACKUP_PATH}; fi'`,
				'Back up the existing provider catalog'
			);
			await runDockerCommand(
				`docker cp "${tmpProviders}" ${CONTAINER_NAME}:${PROVIDERS_CONFIG_PATH}`,
				'Install the provider catalog'
			);
			// `docker cp` lands the file as root; the session runs as user1 and writes
			// back to this file when a provider's connection changes.
			await runDockerCommand(
				`docker exec ${CONTAINER_NAME} chown -R user1 ${AI_CONFIG_DIR}`,
				'Set ownership of the AI config directory'
			);
		} finally {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
		}

		// The server watches providers.json, but reloading makes the observation
		// deterministic instead of racing the watcher's debounce.
		await app.workbench.hotKeys.reloadWindow();
	});

	test.afterAll('Restore the session catalog', async function ({ runDockerCommand }) {
		// Leaving Posit AI enabled would carry into the other suites sharing this
		// container, so restore the catalog the extension had written. There is no
		// reload to do: the worker fixture quits this session on teardown and the next
		// suite's session reads the restored file on startup.
		await runDockerCommand(
			`docker exec ${CONTAINER_NAME} bash -lc 'if [ -f ${PROVIDERS_CONFIG_BACKUP_PATH} ]; then mv ${PROVIDERS_CONFIG_BACKUP_PATH} ${PROVIDERS_CONFIG_PATH}; else rm -f ${PROVIDERS_CONFIG_PATH}; fi'`,
			'Restore the original provider catalog'
		);
	});

	for (const provider of SIGNIN_PROVIDERS) {
		test(`${provider} - Sign in, send hello, sign out`, async function ({ app }) {
			await app.workbench.modelProviderAuth.loginModelProvider(provider);

			try {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();

				// Select the just-signed-in provider's model rather than relying on an
				// auto-selected default: the providers in this suite stay signed in until
				// their own test's teardown, and model names repeat across providers, so a
				// default may belong to the wrong one. `newConversation: false` keeps the
				// selection instead of resetting to a fresh chat.
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.sendMessage(HELLO_PROMPT, true, { newConversation: false });
				await app.workbench.positAssistant.expectResponseVisible();

				// Assert the model answered the prompt, not merely that some text
				// rendered: a length check also passes on an error or a refusal shown in
				// the response body. The prompt pins the wording so this is a fair
				// expectation of any provider's model; the match stays case-insensitive
				// because capitalization and trailing punctuation are still the model's
				// to choose.
				const responseText = await app.workbench.positAssistant.getLastResponseText();
				expect(responseText).toMatch(/hello/i);
			} finally {
				await app.workbench.modelProviderAuth.logoutModelProvider(provider);
			}
		});
	}
});
