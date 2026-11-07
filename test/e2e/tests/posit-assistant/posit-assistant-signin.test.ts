/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { ModelProvider } from '../../pages/modelProviderShared';

test.use({
	suiteId: __filename,
	// appEnv keeps API keys out of the app's env, so the API-key providers start disconnected
	// and the test drives the provider manager's connect flow (typing ANTHROPIC_KEY / OPENAI_KEY).
});

// Apart from the dev-build update in beforeAll, do not reach for a window reload. A
// restarted extension host re-probes the cloud credential-chain metadata endpoints
// (AWS/Azure IMDS, metadata.google.internal). Those are unreachable from the test
// container and hang, starving DNS for api.anthropic.com and api.openai.com. Provider
// key validation then times out and the provider screen never reaches the Connected
// view. Settings that need to be in place go through `extraSettings`,
// which is written before the app starts and so needs no reload.
//
// The dev-build update is the one deliberate exception: it is how this suite tests
// unreleased Assistant changes, and installing the new build needs a reload. It runs
// before the first sign-in, so no provider is mid-validation when the extension host
// restarts.

const POSIT_ASSISTANT_SIGNIN_PROVIDERS: ModelProvider[] = [
	'anthropic',
	'openai',
	// Skipped below: see BEDROCK_SKIP_REASON before re-enabling.
	'bedrock',
	'positai',
	// Microsoft Foundry (Azure) via API key + Base URL on desktop. The managed
	// credentials path is covered separately in the workbench suite.
	'ms-foundry',
];

// Do not re-enable without security sign-off (SEC-3673). Bedrock signs in only from
// AWS credentials in the app's own environment. CI no longer passes secrets into the
// app, because app logs leaked them into uploaded test reports.
const BEDROCK_SKIP_REASON = 'SEC-3673: needs AWS credentials in the app env, which CI no longer passes in';

test.describe('Posit Assistant Sign-in', {
	tag: [tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.positAssistant.checkForDevBuildUpdate(settings, app.workbench.quickaccess);
	});

	for (const provider of POSIT_ASSISTANT_SIGNIN_PROVIDERS) {
		test(`${provider} - Sign in, send hello, sign out`, async function ({ app }) {
			test.skip(provider === 'bedrock', BEDROCK_SKIP_REASON);
			await app.workbench.providerManager.loginModelProvider(provider);

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
				await app.workbench.providerManager.logoutModelProvider(provider);
			}
		});
	}
});
