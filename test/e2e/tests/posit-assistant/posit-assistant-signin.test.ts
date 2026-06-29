/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/modelProviderAuth';

test.use({
	suiteId: __filename
});

const POSIT_ASSISTANT_SIGNIN_PROVIDERS: ModelProvider[] = [
	'anthropic-api',
	'openai-api',
	'amazon-bedrock',
	'posit-ai',
	// Microsoft Foundry (Azure) via API key + Base URL on desktop. The managed
	// credentials path is covered separately in the workbench suite.
	'ms-foundry',
];

test.describe('Posit Assistant Sign-in', {
	tag: [tags.POSIT_ASSISTANT, tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	for (const provider of POSIT_ASSISTANT_SIGNIN_PROVIDERS) {
		test(`${provider} - Sign in, send hello, sign out`, async function ({ app }) {
			await app.workbench.modelProviderAuth.loginModelProvider(provider);

			try {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();
				await app.workbench.positAssistant.startNewConversation();

				if (provider === 'openai-api') {
					// OpenAI does not auto-select a default model, so pick one
					// explicitly. `newConversation: false` avoids starting a
					// fresh chat after model selection, which would drop it.
					await app.workbench.positAssistant.selectModel('GPT-5.4');
					await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
				} else if (provider === 'ms-foundry') {
					// Foundry doesn't auto-select a default model on desktop, so pick
					// it explicitly. In the model picker the model is listed under its
					// provider name, "Microsoft Foundry". `newConversation: false`
					// keeps the selection instead of resetting to a fresh chat.
					await app.workbench.positAssistant.selectModel('Microsoft Foundry');
					await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
				} else {
					await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: true });
				}
				await app.workbench.positAssistant.expectResponseVisible();

				const responseText = await app.workbench.positAssistant.getLastResponseText();
				test.expect(responseText.length).toBeGreaterThan(0);
			} finally {
				await app.workbench.modelProviderAuth.logoutModelProvider(provider);
			}
		});
	}
});
