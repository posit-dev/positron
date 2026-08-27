/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Posit Assistant against Databricks Foundation Models on Posit Workbench, using
 * the Workbench-managed Databricks credential.
 *
 * Its own file (and its own shard tag) because the credential is provisioned per
 * container: the Databricks stack has to be the one running, which the
 * `@:workbench-databricks` tag selects. Snowflake Cortex gets the same treatment
 * in `posit-assistant-snowflake.test.ts`, and Microsoft Foundry in
 * `posit-assistant-foundry.test.ts`.
 */

import { expect, test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename,
	managedCredentials: 'databricks',
});

// Pins the reply to a single known word so the response assertion can check for
// it. A bare "Say hello" leaves the model free to answer with a greeting that
// never contains the word.
const HELLO_PROMPT = 'Reply with only the word hello.';

test.describe('Posit Assistant - Databricks (Workbench managed credentials)', {
	tag: [tags.WORKBENCH_DATABRICKS, tags.ASSISTANT],
}, () => {
	test('Databricks model responds when authenticated via Workbench managed credentials', async function ({ app }) {
		// No interactive sign-in: the Workbench dashboard's Databricks credential
		// (set up by the fixture before the session launches) writes a
		// posit-workbench-managed profile and points DATABRICKS_CONFIG_FILE at it.
		// The authentication extension's Databricks credential chain reads that
		// profile on activation (registerDatabricksProvider ->
		// resolveChainCredentials), so a session already exists here -- which is
		// exactly the path a Workbench user gets and the desktop OAuth/PAT tests
		// cannot reach.
		await app.workbench.positAssistant.open();
		await app.workbench.positAssistant.waitForReady();
		await app.workbench.positAssistant.startNewConversation();

		// Other base-fixture providers stay enabled but unauthenticated on this
		// shard, and model display names repeat across providers, so scope the
		// choice to the Databricks group rather than relying on an auto-selected
		// default. `newConversation: false` keeps the model we just picked instead
		// of resetting to a fresh chat.
		await app.workbench.positAssistant.selectProviderModel('databricks');
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
