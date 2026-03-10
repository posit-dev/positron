"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.tags = void 0;
exports.runEvalTest = runEvalTest;
exports.evalTests = evalTests;
const _test_setup_1 = require("../../_test.setup");
Object.defineProperty(exports, "tags", { enumerable: true, get: function () { return _test_setup_1.tags; } });
const llm_grader_1 = require("./llm-grader");
const format_results_1 = require("./format-results");
const eval_results_1 = require("./eval-results");
const metric_assistant_1 = require("../../../utils/metrics/metric-assistant");
/**
 * Runs a single eval test case: executes the test, evaluates with LLM, attaches results, records metrics.
 *
 * @param testCase The test case to run
 * @param modelKey Short model key (e.g., 'sonnet', 'opus')
 * @param modelDisplayName Display name for reports (e.g., 'claude sonnet 4')
 * @param category Category for metrics (e.g., 'notebooks', 'tools')
 * @param fixtures Playwright test fixtures
 */
async function runEvalTest(testCase, modelKey, modelDisplayName, category, fixtures) {
    const { app, sessions, hotKeys, cleanup, settings, logger } = fixtures;
    // Run the test and get response with timing
    const result = await testCase.run({ app, sessions, hotKeys, cleanup, settings });
    const { response, timing } = result;
    // Use llmResponseMs which excludes button interaction time
    const responseDurationMs = timing.llmResponseMs;
    (0, _test_setup_1.expect)(response?.trim(), 'Expected a non-empty response from assistant').toBeTruthy();
    // Evaluate the response using the LLM grader
    const evaluation = await (0, llm_grader_1.evaluateWithLLM)({
        response,
        criteria: testCase.evaluationCriteria,
        apiKey: process.env.ANTHROPIC_KEY,
    });
    // Attach results HTML to test report
    const resultsHtml = (0, format_results_1.formatResultsHtml)({
        testId: testCase.id,
        description: testCase.description,
        model: modelDisplayName,
        grade: evaluation.grade,
        explanation: evaluation.explanation,
        question: testCase.prompt,
        response,
    });
    await _test_setup_1.test.info().attach('evaluation-result.html', {
        body: resultsHtml,
        contentType: 'text/html',
    });
    // Record metric for dashboard/QueryChat
    const metricInput = {
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
        toolsCalled: (0, metric_assistant_1.parseToolsFromResponse)(response),
        grade: evaluation.grade,
        gradeExplanation: evaluation.explanation,
        requiredCriteriaCount: testCase.evaluationCriteria.required.length,
        optionalCriteriaCount: testCase.evaluationCriteria.optional?.length ?? 0,
        failIfCriteriaCount: testCase.evaluationCriteria.failIf?.length ?? 0,
    };
    await (0, metric_assistant_1.recordAssistantEval)(metricInput, responseDurationMs, !!app.code.electronApp, logger);
}
/**
 * Sets up eval tests inside a test.describe block.
 * Handles assistant login/logout and registers tests for all configured models.
 *
 * @param test The Playwright test object
 * @param testCases Array of test cases to run
 * @param options Configuration options
 *
 * @example
 * test.describe('Assistant Eval: Notebooks', { tag: [tags.ASSISTANT_EVAL] }, () => {
 *   evalTests(test, [
 *     rNotebookGetCells,
 *     pyNotebookGetCells,
 *   ], { category: 'notebooks' });
 * });
 */
function evalTests(test, testCases, options = {}) {
    const { category = 'general' } = options;
    test.beforeAll(async ({ assistant }) => {
        await assistant.openPositronAssistantChat();
        await assistant.loginModelProvider('anthropic-api');
    });
    (0, eval_results_1.getModelKeys)().forEach((modelKey, index) => {
        const modelConfig = (0, eval_results_1.getModelConfig)(modelKey);
        test.describe(modelKey, () => {
            test.beforeAll(async ({ assistant }) => {
                if (index > 0 || modelKey !== 'sonnet') {
                    await assistant.selectChatModel(modelConfig.pickerName);
                }
            });
            testCases.forEach((testCase) => {
                test(`${testCase.id}: ${testCase.description}`, { tag: testCase.tags ?? [] }, async ({ app, sessions, hotKeys, cleanup, settings, logger }) => {
                    await runEvalTest(testCase, modelKey, modelConfig.displayName, category, {
                        app, sessions, hotKeys, cleanup, settings, logger
                    });
                });
            });
        });
    });
    test.afterAll(async ({ assistant }) => {
        await assistant.logoutModelProvider('anthropic-api');
    });
}
//# sourceMappingURL=eval-runner.js.map