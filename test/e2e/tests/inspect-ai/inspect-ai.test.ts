/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, tags } from '../_test.setup';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getActionsForSample, ActionContext } from '../../../assistant-inspect-ai/actions';

/**
 * Removes UTF-8 BOM (Byte Order Mark) from the beginning of a string
 * @param content - The string content that may have a BOM
 * @returns The content without BOM
 */
function removeBOM(content: string): string {
	if (content.charCodeAt(0) === 0xFEFF) {
		return content.slice(1);
	}
	return content;
}

/**
 * Sanitizes response text to handle control characters and ensure valid UTF-8
 * @param response - The response text to sanitize
 * @returns Sanitized text safe for JSON serialization
 */
function sanitizeResponse(response: string): string {
	if (!response) {
		return '';
	}

	// Remove or replace problematic control characters (except newlines, tabs, carriage returns)
	const sanitized = response
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except \t, \n, \r
		.replace(/\uFEFF/g, '') // Remove BOM characters that might be in the response
		.trim();

	// Ensure the string is valid UTF-8 by attempting to encode/decode
	try {
		const buffer = Buffer.from(sanitized, 'utf8');
		return buffer.toString('utf8');
	} catch (error) {
		console.warn('UTF-8 encoding issue detected, attempting to clean response');
		// Fallback: replace invalid UTF-8 sequences
		return Buffer.from(sanitized, 'utf8').toString('utf8');
	}
}

/**
 * Safely reads and parses a JSON file with UTF-8 BOM handling
 * @param filePath - Path to the JSON file
 * @returns Parsed JSON object
 */
function readJSONFile(filePath: string): any {
	try {
		const rawContent = readFileSync(filePath, 'utf-8');
		const cleanContent = removeBOM(rawContent);
		return JSON.parse(cleanContent);
	} catch (error) {
		throw new Error(`Failed to read or parse JSON file ${filePath}: ${error}`);
	}
}

/**
 * Safely writes JSON data to file with proper UTF-8 encoding and validation
 * @param filePath - Path where to write the file
 * @param data - Data to serialize and write
 */
function writeJSONFile(filePath: string, data: any): void {
	try {
		const jsonContent = JSON.stringify(data, null, '\t');

		// Write without BOM to ensure cross-platform compatibility
		writeFileSync(filePath, jsonContent, { encoding: 'utf8' });

		// Validate the written file can be read back
		const validation = readFileSync(filePath, 'utf-8');
		JSON.parse(validation);

		console.log(`Successfully wrote and validated JSON file: ${filePath}`);
	} catch (error) {
		throw new Error(`Failed to write JSON file ${filePath}: ${error}`);
	}
}

test.use({
	suiteId: __filename
});

/**
 * Test suite for the validating the responses from Positron assistant. This suite mainly is used to setup
 * the dataset for use in the inspect-ai tests. It also does some basic validation that there are valid responses
 * from the assistant.
 */
test.describe('Positron Assistant Inspect-ai dataset gathering', { tag: [tags.INSPECT_AI] }, () => {
	test.afterAll('Sign out of Assistant', async function ({ app }) {
		// Change veiwport size for web tests
		await app.code.driver.page.setViewportSize({ width: 2560, height: 1440 });
		// Only sign out if USE_KEY environment variable is set
		if (process.env.USE_KEY) {
			await app.workbench.quickaccess.runCommand(`positron-assistant.configureModels`);
			await app.workbench.assistant.selectModelProvider('anthropic-api');
			await app.workbench.assistant.clickSignOutButton();
		}
	});

	/**
	 * Converts a model name to a filename-safe string
	 * @param modelName - The model name to sanitize
	 * @returns A filename-safe version of the model name
	 */
	function modelNameToFilename(modelName: string): string {
		return modelName
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '');
	}

	/**
	 * Load dataset and process each question for all models
	 */
	test('Process Dataset Questions', async function ({ app, sessions, hotKeys, cleanup }) {
		test.setTimeout(15 * 60 * 1000); // 15 minutes (more time for multiple models)
		// Load dataset from file
		const datasetPath = join(__dirname, '../../../assistant-inspect-ai/response-dataset.json');
		const datasetJson = readJSONFile(datasetPath);

		// Extract models array (support both 'models' array and legacy single 'model' field)
		const models: string[] = datasetJson.models || (datasetJson.model ? [datasetJson.model] : ['Claude Sonnet 4']);
		const baseTests = datasetJson.tests || [];

		console.log(`Will process ${baseTests.length} questions for ${models.length} model(s): ${models.join(', ')}`);

		// Start a Python Session
		const [pySession] = await sessions.start(['python']);
		const [rSession] = await sessions.start(['r']);

		// Sign in to the assistant
		await app.workbench.assistant.openPositronAssistantChat();

		// Only sign in if USE_KEY environment variable is set
		if (process.env.USE_KEY) {
			await app.workbench.assistant.clickAddModelButton();
			await app.workbench.assistant.selectModelProvider('anthropic-api');
			await app.workbench.assistant.enterApiKey(`${process.env.ANTHROPIC_KEY}`);
			await app.workbench.assistant.clickSignInButton();
			await app.workbench.assistant.verifySignOutButtonVisible();
			await app.workbench.assistant.clickCloseButton();
		}

		await app.workbench.toasts.closeAll();

		// Build the action context with access to test infrastructure
		const actionContext: ActionContext = {
			app,
			sessions: {
				python: pySession,
				r: rSession,
				select: (id: string) => sessions.select(id),
				restart: (id: string, options?: { clearConsole?: boolean }) => sessions.restart(id, options),
			},
			hotKeys: {
				closeAllEditors: () => hotKeys.closeAllEditors(),
			},
			cleanup: {
				discardAllChanges: () => cleanup.discardAllChanges(),
			},
		};

		// Loop through each model
		for (const modelName of models) {
			console.log(`\n========== Testing model: ${modelName} ==========\n`);

			// Select the model for this iteration
			await app.workbench.assistant.selectChatModel(modelName);

			// Create a fresh copy of test data for this model
			const dataset = JSON.parse(JSON.stringify(baseTests));

			// Track if we've updated any items for this model
			let updatedItems = false;

			// Loop through each question in the dataset
			for (const item of dataset) {

				console.log(`Processing question from dataset: ${item.id} (model: ${modelName})`);

				// Get actions for this sample (may be empty if no actions defined)
				const sampleActions = getActionsForSample(item.id);

				// Execute setup action if one exists for this item
				if (sampleActions.setup) {
					console.log(`Running setup for: ${item.id}`);
					await sampleActions.setup(actionContext);
				}
				await app.workbench.assistant.clickNewChatButton();
				await app.workbench.assistant.selectChatMode(item.mode || 'Ask');
				await app.workbench.assistant.enterChatMessage(item.question, item.waitForResponse !== false);

				// Execute post-question action if one exists for this item
				if (sampleActions.postQuestion) {
					console.log(`Running post-question action for: ${item.id}`);
					await sampleActions.postQuestion(actionContext);
				}

				const response = await app.workbench.assistant.getChatResponseText(app.workspacePathOrFolder);
				console.log(`Response from Assistant for ${item.id}: ${response}`);
				if (!response || response.trim() === '') {
					fail(`No response received for question: ${item.question}`);
				}
				// Sanitize the response to handle UTF-8 and control character issues
				item.model_response = sanitizeResponse(response);
				updatedItems = true;

				// Execute cleanup action if one exists for this item
				if (sampleActions.cleanup) {
					console.log(`Running cleanup for: ${item.id}`);
					await sampleActions.cleanup(actionContext);
				}
			}

			// Write updated dataset back to file for this model
			if (updatedItems) {
				try {
					const outputFilename = `response-dataset-${modelNameToFilename(modelName)}.json`;
					const outputPath = join(__dirname, '../../../assistant-inspect-ai', outputFilename);
					const outputData = { model: modelName, tests: dataset };
					writeJSONFile(outputPath, outputData);
					console.log(`Updated model responses in dataset file: ${outputPath}`);
				} catch (error) {
					fail(`Failed to write updated dataset for ${modelName}: ${error}`);
				}
			}
		}
	});


});


