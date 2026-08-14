/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/modelProviderShared';

test.use({
	suiteId: __filename,
	// Launch the app with the auto-sign-in env vars unset so the API-key providers
	// start disconnected and the test genuinely drives the modal's connect flow
	// (typing ANTHROPIC_KEY / OPENAI_KEY) instead of finding them already signed in.
	// AWS Bedrock keeps its environment credential chain (it has no key to type and
	// authenticates from the environment by design).
	extraEnv: { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined },
});

const NEW_PROVIDER_MODAL_KEY = 'assistant.newProviderModal';

const POSIT_ASSISTANT_SIGNIN_PROVIDERS: ModelProvider[] = [
	'anthropic-api',
	'openai-api',
	'amazon-bedrock',
	'posit-ai',
	// Microsoft Foundry (Azure) via API key + Base URL on desktop. The managed
	// credentials path is covered separately in the workbench suite.
	'ms-foundry',
];

test.describe('Posit Assistant Sign-in (new provider modal)', {
	tag: [tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	test.beforeAll('Enable the new provider modal', async function ({ settings }) {
		// Deliberately no reload: the switch is read live every time the Configure
		// Providers command runs, so the setting takes effect without one. Reloading
		// also broke this suite in CI -- the restarted extension host re-probes the
		// cloud credential-chain metadata endpoints (AWS/Azure IMDS,
		// metadata.google.internal), which are unreachable in the test container and
		// hang. Those pending lookups starve DNS for api.anthropic.com /
		// api.openai.com, so the provider key validation aborted on its fixed 5s
		// budget and the modal never reached the Connected view.
		await settings.set({ [NEW_PROVIDER_MODAL_KEY]: true });
	});

	test.afterAll('Disable the new provider modal', async function ({ settings }) {
		await settings.remove([NEW_PROVIDER_MODAL_KEY]);
	});

	for (const provider of POSIT_ASSISTANT_SIGNIN_PROVIDERS) {
		test(`${provider} - Sign in, send hello, sign out`, async function ({ app }) {
			await app.workbench.modelProviderModal.loginModelProvider(provider);

			try {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();

				// Explicitly select the just-signed-in provider's model rather than
				// relying on an auto-selected default. Other providers can be signed
				// in simultaneously (notably AWS Bedrock, which auto-signs-in when AWS
				// credentials are present in the environment), and model names repeat
				// across providers, so an auto-selected default may belong to the wrong
				// provider. `newConversation: false` keeps the selection instead of
				// resetting to a fresh chat.
				await app.workbench.positAssistant.selectProviderModel(provider);
				await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
				await app.workbench.positAssistant.expectResponseVisible();

				const responseText = await app.workbench.positAssistant.getLastResponseText();
				test.expect(responseText.length).toBeGreaterThan(0);
			} finally {
				await app.workbench.modelProviderModal.logoutModelProvider(provider);
			}
		});
	}
});
