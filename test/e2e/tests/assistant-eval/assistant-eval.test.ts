/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';
import { testCases } from './test-cases';
import { evaluateWithLLM } from './evaluator/llm-grader';
import { printTestResults, GRADE_LABELS } from './evaluator/format-results';
import { getModelKeys, getModelConfig, initResults, saveResult, finalizeResults, generateCatalog } from './evaluator/eval-results';

test.use({
	suiteId: __filename
});

/**
 * Positron Assistant LLM Evaluation Tests
 *
 * Use Opus:      EVAL_MODELS=opus npx playwright test assistant-eval --project e2e-electron
 * Both models:   EVAL_MODELS=sonnet,opus npx playwright test assistant-eval --project e2e-electron
 */
test.describe('Assistant: LLM Evals', { tag: [tags.ASSISTANT_EVAL, tags.SOFT_FAIL] }, () => {

	test.beforeAll(async ({ app }) => {
		initResults();
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('anthropic-api');
	});

	// Generate test suites for each model
	const modelKeys = getModelKeys();

	modelKeys.forEach((modelKey, index) => {
		const modelConfig = getModelConfig(modelKey);

		test.describe(`${modelKey}`, () => {
			test.beforeAll(async ({ app }) => {
				// Sonnet is selected by default after login, skip if first
				if (index > 0 || modelKey !== 'sonnet') {
					await app.workbench.assistant.selectChatModel(modelConfig.pickerName);
				}
			});

			testCases.forEach((testCase) => {
				test(`${testCase.id}: ${testCase.description}`,
					{ tag: testCase.tags ?? [] },
					async ({ app, sessions, hotKeys, cleanup }) => {

						// Run the test case
						const response = await testCase.run({ app, sessions, hotKeys, cleanup });
						expect(response?.trim(), 'Expected a non-empty response from assistant').toBeTruthy();

						// Evaluate with LLM grader
						const evaluation = await evaluateWithLLM({
							response,
							criteria: testCase.evaluationCriteria,
						});

						// Print results
						printTestResults({
							testId: testCase.id,
							description: testCase.description,
							model: modelConfig.displayName,
							grade: evaluation.grade,
							explanation: evaluation.explanation,
							response,
						});

						// Save for eval log
						saveResult({
							id: `${modelKey}_${testCase.id}`,
							description: testCase.description,
							model: modelConfig.displayName,
							response,
							grade: evaluation.grade,
							explanation: evaluation.explanation,
						});

						// Assert: Incomplete = test failure
						expect(
							evaluation.grade,
							`Test failed with grade: ${GRADE_LABELS[evaluation.grade]}\n\n${evaluation.explanation}`
						).not.toBe('I');
					}
				);
			});
		});
	});

	test.afterAll(async ({ app }, testInfo) => {
		const logPath = finalizeResults();
		if (logPath) {
			await testInfo.attach('evaluation-log.json', { path: logPath, contentType: 'application/json' });
		}
		generateCatalog(testCases);
		await app.workbench.assistant.logoutModelProvider('anthropic-api');
	});
});
