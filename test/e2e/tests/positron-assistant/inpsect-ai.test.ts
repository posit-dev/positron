/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

test.use({
	suiteId: __filename
});

/**
 * Test suite for the validating the responses from Positron assistant. This suite mainly is used to setup
 * the dataset for use in the inspect-ai tests. It also does some basic validation that there are valid responses
 * from the assistant.
 */
test.describe('Positron Assistant Inspect-ai dataset gathering', { tag: [tags.INSPECT_AI, tags.WIN, tags.WEB] }, () => {
	test.afterAll('Sign out of Assistant', async function ({ app }) {
		await app.workbench.quickaccess.runCommand(`positron-assistant.configureModels`);
		await app.workbench.assistant.selectModelProvider('Anthropic');
		await app.workbench.assistant.clickSignOutButton();
	});

	/**
	 * Load dataset and process each question
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Process Dataset Questions', async function ({ app }) {
		// Load dataset from file
		const datasetPath = join(__dirname, '../../../assistant-inspect-ai/response-dataset.jsonl');
		const datasetContent = readFileSync(datasetPath, 'utf-8');
		const dataset = datasetContent.trim().split('\n').map(line => JSON.parse(line));

		// Sign in to the assistant
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('Anthropic');
		await app.workbench.assistant.enterApiKey(`${process.env.POSITRON_ATHROPIC_API}`);
		await app.workbench.assistant.clickSignInButton();
		await app.workbench.assistant.verifySignOutButtonVisible();
		await app.workbench.assistant.clickCloseButton();

		// Track if we've updated any items
		let updatedItems = false;

		// Loop through each question in the dataset
		for (const item of dataset) {
			console.log(`Processing question from dataset: ${item.id}`);
			await app.workbench.assistant.clickNewChatButton();
			await app.workbench.assistant.enterChatMessage(item.question);
			await app.workbench.assistant.waitForSendButtonVisible();
			const response = await app.workbench.assistant.getChatResponseText();
			console.log(`Response from Assistant for ${item.id}: ${response}`);

			// Update the model_response in the dataset item
			item.model_response = response;
			updatedItems = true;

			// Wait a bit between questions to avoid rate limiting
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		// Write updated dataset back to file if any items were updated
		if (updatedItems) {
			const updatedDatasetContent = dataset.map(item => JSON.stringify(item)).join('\n');
			writeFileSync(datasetPath, updatedDatasetContent, 'utf-8');
			console.log(`Updated model responses in dataset file: ${datasetPath}`);
		}
	});


});


