/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

const provider = 'databricks';

test.use({
	suiteId: __filename,
	// Keep the credential chain out of the way. `createSession` resolves a
	// DATABRICKS_TOKEN (+ DATABRICKS_HOST) session before it ever reaches the browser
	// flow or the stored PAT, so a polluted environment would leave the row already
	// connected and neither test below would exercise anything.
	extraEnv: { DATABRICKS_TOKEN: undefined, DATABRICKS_HOST: undefined },
});

// Databricks is the one provider whose sign-in differs by build, so it gets its own
// file rather than joining the provider loop in posit-assistant-signin.test.ts:
//
//   - Desktop advertises OAuth (authorization code + PKCE against a loopback server
//     on ports 8020-8040) and API Key.
//   - Web and remote advertise API Key only -- the loopback redirect cannot reach an
//     extension host on another machine. See `supportedOptions` in the authentication
//     extension's providerSources.ts.
//
// So the OAuth case is tagged for desktop lanes only, and the API-key case carries WEB
// so the chromium lane covers the path that build actually offers. Tags cannot be
// subtracted per-test, which is the other reason these are not in the signin suite.

// The OAuth case additionally depends on the Databricks workspace hosts being in
// product.json's `linkProtectionTrustedDomains`. Without that, the opener service's
// trusted-domains validator prompts before handing the authorize URL to the browser, and
// under the e2e driver Positron refuses to show prompts at all (dialogService.ts), so
// sign-in fails before it starts rather than showing a dialog a test could answer.

test.describe('Posit Assistant - Databricks OAuth', {
	tag: [tags.ASSISTANT],
}, () => {
	test('Sign in with OAuth, send hello, sign out', async function ({ app }) {
		// The Okta credentials are wired per lane, so skip rather than fail where they
		// are absent (the same convention the Redshift data-connection tests follow).
		test.skip(!process.env.DATABRICKS_URL || !process.env.IDE_SERVICE_ACCOUNT_OTP_SECRET,
			'Databricks OAuth requires DATABRICKS_URL and the IDE service account credentials');

		// Okta's TOTP is shared with other shards, and a rejected code costs a 31-46s
		// backoff before the retry (see otpRetry.ts). Two of those blow the default
		// 2-minute budget on their own.
		test.slow();

		await app.workbench.modelProviderModal.loginModelProvider(provider, {
			authMethod: 'oauth',
			baseUrl: process.env.DATABRICKS_URL,
		});

		try {
			await app.workbench.positAssistant.open();
			await app.workbench.positAssistant.waitForReady();
			await app.workbench.positAssistant.startNewConversation();

			// Select the Databricks model explicitly: other providers can be signed in at
			// the same time (AWS Bedrock auto-signs-in from the environment) and model
			// names repeat across providers, so an auto-selected default may belong to
			// another one. `newConversation: false` keeps the selection.
			await app.workbench.positAssistant.selectProviderModel(provider);
			await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
			await app.workbench.positAssistant.expectResponseVisible();

			const responseText = await app.workbench.positAssistant.getLastResponseText();
			test.expect(responseText.length).toBeGreaterThan(0);
		} finally {
			await app.workbench.modelProviderModal.logoutModelProvider(provider);
		}
	});
});

// WIN covers the Windows lane and, because the e2e-macOS-ci project greps /@:win/, the
// macOS one too. Both already export DATABRICKS_WORKSPACE and DATABRICKS_PAT for the
// catalog-explorer suite, so the API-key case runs there for free. The OAuth case stays
// off those lanes deliberately: it would need the Okta secrets added to two more
// workflows and would put two more consumers on the shared TOTP.
test.describe('Posit Assistant - Databricks API Key', {
	tag: [tags.ASSISTANT, tags.WEB, tags.WIN],
}, () => {
	test('Sign in with a personal access token, send hello, sign out', async function ({ app }) {
		test.skip(!process.env.DATABRICKS_PAT || !process.env.DATABRICKS_WORKSPACE,
			'Databricks API key sign-in requires DATABRICKS_WORKSPACE and DATABRICKS_PAT');

		// DATABRICKS_PAT / DATABRICKS_WORKSPACE, resolved by the page object from the
		// provider's env var names. Both are already present in the desktop lanes for
		// the catalog-explorer suite.
		await app.workbench.modelProviderModal.loginModelProvider(provider, {
			authMethod: 'apiKey',
		});

		try {
			await app.workbench.positAssistant.open();
			await app.workbench.positAssistant.waitForReady();
			await app.workbench.positAssistant.startNewConversation();

			await app.workbench.positAssistant.selectProviderModel(provider);
			await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
			await app.workbench.positAssistant.expectResponseVisible();

			const responseText = await app.workbench.positAssistant.getLastResponseText();
			test.expect(responseText.length).toBeGreaterThan(0);
		} finally {
			await app.workbench.modelProviderModal.logoutModelProvider(provider);
		}
	});
});
