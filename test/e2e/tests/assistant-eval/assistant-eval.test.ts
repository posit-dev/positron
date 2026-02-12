/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';
import { testCases } from './test-cases';
import { evaluateWithLLM } from './evaluator/llm-grader';
import { formatResultsHtml } from './evaluator/format-results';
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
test.describe('Assistant: LLM Evals', { tag: [tags.ASSISTANT_EVAL] }, () => {

	test.beforeAll(async ({ assistant }) => {
		initResults();
		await assistant.openPositronAssistantChat();
		await assistant.loginModelProvider('anthropic-api');
	});

	// Generate test suites for each model
	const modelKeys = getModelKeys();

	modelKeys.forEach((modelKey, index) => {
		const modelConfig = getModelConfig(modelKey);

		test.describe(`${modelKey}`, () => {
			test.beforeAll(async ({ assistant }) => {
				// Skip model selection if first model AND it's sonnet (the default after login)
				if (index > 0 || modelKey !== 'sonnet') {
					await assistant.selectChatModel(modelConfig.pickerName);
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
							apiKey: process.env.ANTHROPIC_KEY,
						});

						// Attach results to Playwright report
						const resultsHtml = formatResultsHtml({
							testId: testCase.id,
							description: testCase.description,
							model: modelConfig.displayName,
							grade: evaluation.grade,
							explanation: evaluation.explanation,
							question: testCase.prompt,
							response,
						});
						await test.info().attach('evaluation-result.html', {
							body: resultsHtml,
							contentType: 'text/html',
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

						// Intentionally skipping assertion to leverage Insights Dashboard.
						// expect(
						// 	evaluation.grade,
						// 	`Test failed with grade: ${GRADE_LABELS[evaluation.grade]}\n\n${evaluation.explanation}`
						// ).not.toBe('I');
					}
				);
			});
		});
	});

	test.afterAll(async ({ assistant }, testInfo) => {
		const logPath = finalizeResults();
		if (logPath) {
			await testInfo.attach('evaluation-log.json', { path: logPath, contentType: 'application/json' });
		}
		generateCatalog(testCases);
		await assistant.logoutModelProvider('anthropic-api');
	});
});
