/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as baseTest, expect } from '../../_test.setup';
import { EvalTestCase } from '../types';
import { evaluateWithLLM } from './llm-grader';
import { formatResultsHtml } from './format-results';
import { getModelKeys, getModelConfig } from './eval-results';
import { recordAssistantEval, parseToolsFromResponse, type AssistantEvalInput } from '../../../utils/metrics/metric-assistant';
import { type Application, type MultiLogger, type Sessions, type HotKeys, type TestTeardown } from '../../../infra';
import { type Settings } from '../../../fixtures/test-setup/settings.fixtures';

/**
 * Fixtures required for running eval tests.
 */
export interface EvalTestFixtures {
	app: Application;
	sessions: Sessions;
	hotKeys: HotKeys;
	cleanup: TestTeardown;
	settings: Settings;
	logger: MultiLogger;
}

/**
 * Runs a single eval test case: executes the test, evaluates with LLM, attaches results, records metrics.
 *
 * @param testCase The test case to run
 * @param modelKey Short model key (e.g., 'sonnet', 'opus')
 * @param modelDisplayName Display name for reports (e.g., 'claude sonnet 4')
 * @param category Category for metrics (e.g., 'notebooks', 'tools')
 * @param fixtures Playwright test fixtures
 */
export async function runEvalTest(
	testCase: EvalTestCase,
	modelKey: string,
	modelDisplayName: string,
	category: string,
	fixtures: EvalTestFixtures
): Promise<void> {
	const { app, sessions, hotKeys, cleanup, settings, logger } = fixtures;

	// Time the assistant response
	const startTime = Date.now();
	const response = await testCase.run({ app, sessions, hotKeys, cleanup, settings });
	const responseDurationMs = Date.now() - startTime;

	expect(response?.trim(), 'Expected a non-empty response from assistant').toBeTruthy();

	// Evaluate the response using the LLM grader
	const evaluation = await evaluateWithLLM({
		response,
		criteria: testCase.evaluationCriteria,
		apiKey: process.env.ANTHROPIC_KEY,
	});

	// Attach results HTML to test report
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

	// Record metric for dashboard/QueryChat
	const metricInput: AssistantEvalInput = {
		testId: testCase.id,
		description: testCase.description,
		category,
		prompt: testCase.prompt,
		mode: testCase.mode,
		language: testCase.language,
		tags: testCase.tags?.map(t => String(t)) ?? [],
		modelKey,
		modelDisplayName,
		response,
		toolsCalled: parseToolsFromResponse(response),
		grade: evaluation.grade,
		gradeExplanation: evaluation.explanation,
		requiredCriteriaCount: testCase.evaluationCriteria.required.length,
		optionalCriteriaCount: testCase.evaluationCriteria.optional?.length ?? 0,
		failIfCriteriaCount: testCase.evaluationCriteria.failIf?.length ?? 0,
	};

	await recordAssistantEval(metricInput, responseDurationMs, !!app.code.electronApp, logger);
}

/**
 * Registers eval tests for all configured models and test cases.
 * Call this inside a test.describe block after setting up beforeAll/afterAll.
 *
 * @param test The Playwright test object
 * @param testCases Array of test cases to run
 * @param category Category for metrics (e.g., 'notebooks', 'tools', 'hallucination')
 *
 * @example
 * test.describe('Assistant Eval: Notebooks', { tag: [...] }, () => {
 *   test.beforeAll(async ({ assistant }) => {
 *     await assistant.openPositronAssistantChat();
 *     await assistant.loginModelProvider('anthropic-api');
 *   });
 *
 *   registerEvalTests(test, testCases, 'notebooks');
 *
 *   test.afterAll(async ({ assistant }) => {
 *     await assistant.logoutModelProvider('anthropic-api');
 *   });
 * });
 */
export function registerEvalTests(
	test: typeof baseTest,
	testCases: EvalTestCase[],
	category: string
): void {
	getModelKeys().forEach((modelKey, index) => {
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
					async ({ app, sessions, hotKeys, cleanup, settings, logger }) => {
						await runEvalTest(testCase, modelKey, modelConfig.displayName, category, {
							app, sessions, hotKeys, cleanup, settings, logger
						});
					}
				);
			});
		});
	});
}
