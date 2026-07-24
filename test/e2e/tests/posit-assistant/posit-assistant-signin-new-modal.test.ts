/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/modelProviderShared';

test.use({
	suiteId: __filename
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
		await settings.set({ [NEW_PROVIDER_MODAL_KEY]: true }, { reload: true });
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
