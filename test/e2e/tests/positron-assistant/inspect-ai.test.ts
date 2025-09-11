/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, tags } from '../_test.setup';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

/**
 * Test suite for the validating the responses from Positron assistant. This suite mainly is used to setup
 * the dataset for use in the inspect-ai tests. It also does some basic validation that there are valid responses
 * from the assistant.
 */
test.describe('Positron Assistant Inspect-ai dataset gathering', { tag: [tags.INSPECT_AI, tags.WIN, tags.WEB, tags.NIGHTLY_ONLY] }, () => {
	test.afterAll('Sign out of Assistant', async function ({ app }) {
		// Only sign out if USE_KEY environment variable is set
		if (process.env.USE_KEY) {
			await app.workbench.quickaccess.runCommand(`positron-assistant.configureModels`);
			await app.workbench.assistant.selectModelProvider('anthropic-api');
			await app.workbench.assistant.clickSignOutButton();
		}
	});

	/**
	 * Load dataset and process each question
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Process Dataset Questions', async function ({ app, sessions, hotKeys }) {
		// Load dataset from file
		const datasetPath = join(__dirname, '../../../assistant-inspect-ai/response-dataset.json');
		const datasetContent = readFileSync(datasetPath, 'utf-8');
		const dataset = JSON.parse(datasetContent);

		// Start a Python Session
		const [pySession] = await sessions.start(['python']);

		// Sign in to the assistant
		await app.workbench.assistant.openPositronAssistantChat();

		// Only sign in if USE_KEY environment variable is set
		if (process.env.USE_KEY) {
			await app.workbench.assistant.clickAddModelButton();
			await app.workbench.assistant.selectModelProvider('anthropic-api');
			await app.workbench.assistant.enterApiKey(`${process.env.ANTHROPIC_API_KEY}`);
			await app.workbench.assistant.clickSignInButton();
			await app.workbench.assistant.verifySignOutButtonVisible();
			await app.workbench.assistant.clickCloseButton();
		}

		await app.workbench.toasts.closeAll();

		// Track if we've updated any items
		let updatedItems = false;

		// Define setup actions in a separate object (could even be moved to its own file later)
		const setupActions = {
			'sample_3': async (app: any) => {
				await expect(async () => {
					await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
					await app.workbench.quickaccess.runCommand('python.execInConsole');
				}).toPass({ timeout: 5000 });
			}
			// Easy to add more cases here as needed
		} as const;
		// Define cleanup actions in a separate object (could even be moved to its own file later)
		const cleanupActions = {
			'sample_3': async (app: any) => {

				await hotKeys.closeAllEditors();
				await sessions.restart(pySession.id);

			}
			// Easy to add more cases here as needed
		} as const;

		// Loop through each question in the dataset
		for (const item of dataset) {

			console.log(`Processing question from dataset: ${item.id}`);

			// Execute setup action if one exists for this item
			const setupAction = setupActions[item.id as keyof typeof setupActions];
			if (setupAction) {
				console.log(`Running setup for: ${item.id}`);
				await setupAction(app);
			}
			await app.workbench.assistant.clickNewChatButton();
			await app.workbench.assistant.enterChatMessage(item.question);
			await app.workbench.assistant.waitForSendButtonVisible();
			await app.code.wait(5000);
			const response = await app.workbench.assistant.getChatResponseText(app.workspacePathOrFolder);
			console.log(`Response from Assistant for ${item.id}: ${response}`);
			if (!response || response.trim() === '') {
				fail(`No response received for question: ${item.question}`);
			}
			item.model_response = response;
			updatedItems = true;

			await new Promise(resolve => setTimeout(resolve, 1000));

			// Execute cleanup action if one exists for this item
			const cleanupAction = cleanupActions[item.id as keyof typeof cleanupActions];
			if (cleanupAction) {
				console.log(`Running cleanup for: ${item.id}`);
				await cleanupAction(app);
			}
		}

		// Write updated dataset back to file if any items were updated
		if (updatedItems) {
			const updatedDatasetContent = JSON.stringify(dataset, null, 2);
			writeFileSync(datasetPath, updatedDatasetContent, 'utf-8');
			console.log(`Updated model responses in dataset file: ${datasetPath}`);
		}
	});


});


