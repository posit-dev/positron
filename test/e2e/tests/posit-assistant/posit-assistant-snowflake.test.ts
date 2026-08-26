/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

const provider = 'snowflake-cortex';

test.use({
	suiteId: __filename,
});

// Snowflake Cortex advertises a single sign-in method everywhere -- an API key (a
// Snowflake programmatic access token) plus the bare account identifier, from which the
// extension derives the Cortex URL (#13750). So there is no auth-method radio group to
// pick from and no build-specific split: the same case runs on desktop and web.
//
// The Workbench-managed credential path is a different provider source (SNOWFLAKE_HOME
// pointing at a posit-workbench connections.toml) and is covered separately in
// tests/workbench/posit-assistant/posit-assistant-snowflake.test.ts. It cannot leak into
// this test: hasManagedCredentials() in the authentication extension is gated on
// IS_RUNNING_ON_PWB, so no env scrubbing is needed here (unlike the Databricks suite,
// which has to unset DATABRICKS_TOKEN).

// Pins the reply to a single known word so the response assertion can check for it,
// matching the Workbench Snowflake test. This matters more here than for the other
// desktop providers: Snowflake has no lightweight key-validation endpoint, so
// validateSnowflakeApiKey only checks the account's *format* and Connect succeeds even
// with a bad token. The first real credential check is this message, and a length-only
// assertion would pass on the error text that a rejected token renders.
const HELLO_PROMPT = 'Reply with only the word hello.';

test.describe('Posit Assistant - Snowflake Cortex API Key', {
	tag: [tags.ASSISTANT, tags.WEB],
}, () => {
	test('Sign in with an API key, send hello, sign out', async function ({ app }) {
		test.skip(!process.env.SNOWFLAKE_API_KEY || !process.env.SNOWFLAKE_ACCOUNT,
			'Snowflake Cortex sign-in requires SNOWFLAKE_ACCOUNT and SNOWFLAKE_API_KEY');

		// SNOWFLAKE_API_KEY / SNOWFLAKE_ACCOUNT, resolved by the page object from the
		// provider's env var names. SNOWFLAKE_ACCOUNT is already present on the Linux
		// lanes for the data-connections Snowflake suite.
		await app.workbench.modelProviderModal.loginModelProvider(provider);

		try {
			await app.workbench.positAssistant.open();
			await app.workbench.positAssistant.waitForReady();
			await app.workbench.positAssistant.startNewConversation();

			// Select the Snowflake Cortex model explicitly: other providers can be signed
			// in at the same time (AWS Bedrock auto-signs-in from the environment) and
			// model names repeat across providers, so an auto-selected default may belong
			// to another one. `newConversation: false` keeps the selection.
			await app.workbench.positAssistant.selectProviderModel(provider);
			await app.workbench.positAssistant.sendMessage(HELLO_PROMPT, true, { newConversation: false });
			await app.workbench.positAssistant.expectResponseVisible();

			const responseText = await app.workbench.positAssistant.getLastResponseText();
			test.expect(responseText).toMatch(/hello/i);
		} finally {
			await app.workbench.modelProviderModal.logoutModelProvider(provider);
		}
	});
});
