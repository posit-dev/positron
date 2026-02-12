/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as baseTest, expect, tags } from '../../_test.setup';
import { EvalTestCase } from '../types';
import { evaluateWithLLM } from './llm-grader';
import { formatResultsHtml } from './format-results';
import { getModelKeys, getModelConfig, initResults, saveResult, finalizeResults, generateCatalog } from './eval-results';

// Re-export for test files
export { tags };
export const EVAL_TAG = tags.ASSISTANT_EVAL;

/**
 * Defines the test structure inside a test.describe block.
 * The test.describe must be in the test file for UI visibility.
 *
 * @example
 * import { test } from '../../_test.setup';
 * import { EVAL_TAG, defineEvalTests } from '../_helpers/test-runner';
 *
 * const testCases = [...];
 *
 * test.describe('Assistant Eval: Hallucination', { tag: [EVAL_TAG] }, () => {
 *   defineEvalTests(test, testCases);
 * });
 */
export function defineEvalTests(
	test: typeof baseTest,
	testCases: EvalTestCase[]
): void {
	test.beforeAll(async ({ assistant }) => {
		initResults();
		await assistant.openPositronAssistantChat();
		await assistant.loginModelProvider('anthropic-api');
	});

	const modelKeys = getModelKeys();

	modelKeys.forEach((modelKey, index) => {
		const modelConfig = getModelConfig(modelKey);

		test.describe(modelKey, () => {
			test.beforeAll(async ({ assistant }) => {
				if (index > 0 || modelKey !== 'sonnet') {
					await assistant.selectChatModel(modelConfig.pickerName);
				}
			});

			testCases.forEach((testCase) => {
				test(`${testCase.id}: ${testCase.description}`,
					{ tag: testCase.tags ?? [] },
					async ({ app, sessions, hotKeys, cleanup, settings }) => {
						await runEvalTest(testCase, modelKey, modelConfig.displayName, {
							app, sessions, hotKeys, cleanup, settings
						});
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
}

/**
 * Runs a single eval test case.
 */
async function runEvalTest(
	testCase: EvalTestCase,
	modelKey: string,
	modelDisplayName: string,
	fixtures: { app: any; sessions: any; hotKeys: any; cleanup: any; settings: any }
): Promise<void> {
	const { app, sessions, hotKeys, cleanup, settings } = fixtures;

	const response = await testCase.run({ app, sessions, hotKeys, cleanup, settings });
	expect(response?.trim(), 'Expected a non-empty response from assistant').toBeTruthy();

	const evaluation = await evaluateWithLLM({
		response,
		criteria: testCase.evaluationCriteria,
		apiKey: process.env.ANTHROPIC_KEY,
	});

	const resultsHtml = formatResultsHtml({
		testId: testCase.id,
		description: testCase.description,
		model: modelDisplayName,
		grade: evaluation.grade,
		explanation: evaluation.explanation,
		question: testCase.prompt,
		response,
	});
	await baseTest.info().attach('evaluation-result.html', {
		body: resultsHtml,
		contentType: 'text/html',
	});

	saveResult({
		id: `${modelKey}_${testCase.id}`,
		description: testCase.description,
		model: modelDisplayName,
		response,
		grade: evaluation.grade,
		explanation: evaluation.explanation,
	});
}
