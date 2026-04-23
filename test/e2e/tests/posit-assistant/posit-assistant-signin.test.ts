/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/positronAssistant';

test.use({
	suiteId: __filename
});

// Posit Assistant and Positron Assistant share the same model provider
// configuration and sign-in flow, so we reuse the `ModelProvider` type.
const POSIT_ASSISTANT_SIGNIN_PROVIDERS: ModelProvider[] = [
	'anthropic-api',
	// 'openai-api',
	// 'amazon-bedrock',
	'posit-ai',
];

test.describe('Posit Assistant Sign-in', {
	tag: [tags.POSIT_ASSISTANT, tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	for (const provider of POSIT_ASSISTANT_SIGNIN_PROVIDERS) {
		test(`${provider} - Sign in, send hello, sign out`, async function ({ app }) {
			await app.workbench.assistant.loginModelProvider(provider);

			try {
				await app.workbench.positAssistant.open();
				await app.workbench.positAssistant.waitForReady();

				await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: true });
				await app.workbench.positAssistant.expectResponseVisible();

				const responseText = await app.workbench.positAssistant.getLastResponseText();
				test.expect(responseText.length).toBeGreaterThan(0);
			} finally {
				await app.workbench.assistant.logoutModelProvider(provider);
			}
		});
	}
});
