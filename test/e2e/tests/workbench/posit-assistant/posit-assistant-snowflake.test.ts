/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Posit Assistant against Snowflake Cortex on Posit Workbench, using the
 * Workbench-managed Snowflake credential.
 *
 * Its own file (and its own shard tag) because the credential is provisioned per
 * container: the Snowflake stack has to be the one running, which the
 * `@:workbench-snowflake` tag selects. Databricks gets the same treatment in
 * `posit-assistant-databricks.test.ts`, and Microsoft Foundry in
 * `posit-assistant-foundry.test.ts`.
 */

import { expect, test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename,
	managedCredentials: 'snowflake',
});

// Pins the reply to a single known word so the response assertion can check for
// it. A bare "Say hello" leaves the model free to answer with a greeting that
// never contains the word.
const HELLO_PROMPT = 'Reply with only the word hello.';

test.describe('Posit Assistant - Snowflake Cortex (Workbench managed credentials)', {
	tag: [tags.WORKBENCH_SNOWFLAKE, tags.ASSISTANT],
}, () => {
	test('Snowflake Cortex model responds when authenticated via Workbench managed credentials', async function ({ app }) {
		// No interactive sign-in: the Workbench dashboard's Snowflake credential
		// (set up by the fixture before the session launches) writes a
		// posit-workbench-managed connections.toml and points SNOWFLAKE_HOME at it.
		// The authentication extension's Snowflake credential chain reads that
		// file on activation (registerSnowflakeProvider -> resolveChainCredentials)
		// and syncs the detected account into the provider catalog, from which the
		// Cortex base URL is derived -- so a session already exists here. That is
		// the path a Workbench user gets, and no desktop sign-in test reaches it.
		await app.workbench.positAssistant.open();
		await app.workbench.positAssistant.waitForReady();
		await app.workbench.positAssistant.startNewConversation();

		// Other base-fixture providers stay enabled but unauthenticated on this
		// shard, and model display names repeat across providers, so scope the
		// choice to the Snowflake Cortex group rather than relying on an
		// auto-selected default. `newConversation: false` keeps the model we just
		// picked instead of resetting to a fresh chat.
		await app.workbench.positAssistant.selectProviderModel('snowflake-cortex');
		await app.workbench.positAssistant.sendMessage(HELLO_PROMPT, true, { newConversation: false });
		await app.workbench.positAssistant.expectResponseVisible();

		// Assert the model answered the prompt, not merely that some text
		// rendered: a length check also passes on an error or a refusal shown in
		// the response body. The match stays case-insensitive because
		// capitalization and trailing punctuation are still the model's to choose.
		const responseText = await app.workbench.positAssistant.getLastResponseText();
		expect(responseText).toMatch(/hello/i);
	});
});
