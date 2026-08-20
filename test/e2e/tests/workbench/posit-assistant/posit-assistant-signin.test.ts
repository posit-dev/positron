/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Posit Assistant sign-in coverage on Posit Workbench, through the Configure LLM
 * Providers modal.
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

import { expect, test, tags } from '../../_test.setup';
import { ModelProvider } from '../../../pages/modelProviderShared';

test.use({
	suiteId: __filename,
	// On Workbench the authentication extension disables Posit AI on first
	// activation so admins control AI access, and the catalog file it writes ranks
	// above any setting -- so the Posit AI tile is absent from the modal entirely
	// unless the catalog says otherwise. The fixture seeds it before the session
	// starts, which is also what lets this suite avoid a window reload (see
	// `enablePositAIProviderInContainer`).
	enablePositAIProvider: true,
});

const SIGNIN_PROVIDERS: ModelProvider[] = ['anthropic-api', 'openai-api', 'posit-ai'];

// Pins the reply to a single known word so the response assertion can check for
// it. A bare "Say hello" leaves the model free to answer with a greeting that
// never contains the word.
const HELLO_PROMPT = 'Reply with only the word hello.';

test.describe('Posit Assistant Sign-in - Workbench', {
	tag: [tags.WORKBENCH, tags.ASSISTANT],
}, () => {

	for (const provider of SIGNIN_PROVIDERS) {
		test(`${provider} - Sign in, send hello, sign out`, async function ({ app }) {
			await app.workbench.modelProviderModal.loginModelProvider(provider);

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
				await app.workbench.modelProviderModal.logoutModelProvider(provider);
			}
		});
	}
});
