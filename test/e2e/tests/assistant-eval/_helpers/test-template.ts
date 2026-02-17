/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as baseTest, expect, tags } from '../../_test.setup';
import { EvalTestCase } from '../types';
import { evaluateWithLLM } from './llm-grader';
import { formatResultsHtml } from './format-results';
import { getModelKeys, getModelConfig } from './eval-results';
import { recordAssistantEval, parseToolsFromResponse, type AssistantEvalInput } from '../../../utils/metrics/metric-assistant';
import { type Application, type MultiLogger, type Sessions, type HotKeys, type TestTeardown } from '../../../infra';
import { type Settings } from '../../../fixtures/test-setup/settings.fixtures';

// Re-export for test files
export { tags };

/**
 * Options for configuring eval tests.
 */
export interface EvalTestsOptions {
	/** Category for metrics (e.g., 'notebooks', 'tools', 'hallucination'). Defaults to 'general'. */
	category?: string;
}

/**
 * Sets up the eval test structure inside a test.describe block.
 * The test.describe must be in the test file for UI visibility.
 *
 * @example
 * import { test } from '../../_test.setup';
 * import { tags, evalTests } from '../_helpers/test-template';
 * import { myTestCase } from './my-test-case';
 *
 * test.describe('Assistant Eval: Category', { tag: [tags.ASSISTANT_EVAL] }, () => {
 *   evalTests(test, [
 *     myTestCase,
 *   ], { category: 'notebooks' });
 * });
 */
export function evalTests(
	test: typeof baseTest,
	testCases: EvalTestCase[],
	options: EvalTestsOptions = {}
): void {
	const { category = 'general' } = options;
	test.beforeAll(async ({ assistant }) => {
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
					async ({ app, sessions, hotKeys, cleanup, settings, logger }) => {
						await runEvalTest(testCase, modelKey, modelConfig.displayName, category, {
							app, sessions, hotKeys, cleanup, settings, logger
						});
					}
				);
			});
		});
	});

	test.afterAll(async ({ assistant }) => {
		await assistant.logoutModelProvider('anthropic-api');
	});
}

/**
 * Runs a single eval test case and records metrics.
 */
interface RunEvalTestFixtures {
	app: Application;
	sessions: Sessions;
	hotKeys: HotKeys;
	cleanup: TestTeardown;
	settings: Settings;
	logger: MultiLogger;
}

async function runEvalTest(
	testCase: EvalTestCase,
	modelKey: string,
	modelDisplayName: string,
	category: string,
	fixtures: RunEvalTestFixtures
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
