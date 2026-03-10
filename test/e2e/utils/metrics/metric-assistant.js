"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseToolsFromResponse = parseToolsFromResponse;
exports.getCategoryTargetType = getCategoryTargetType;
exports.recordAssistantEval = recordAssistantEval;
exports.recordAssistantEvalWithTiming = recordAssistantEvalWithTiming;
const api_js_1 = require("./api.js");
//-----------------------
// Helper Functions
//-----------------------
/**
 * Parses tools called from the assistant response.
 * Extracts tool names from "Tools called: tool1, tool2" format.
 */
function parseToolsFromResponse(response) {
    const toolsMatch = response.match(/Tools called:\s*(.+?)(?:\n|$)/i);
    if (!toolsMatch) {
        return [];
    }
    return toolsMatch[1]
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
}
/**
 * Maps test category/id to target type for metrics.
 */
function getCategoryTargetType(category) {
    const categoryMap = {
        'notebooks': 'eval.notebooks',
        'tools': 'eval.tools',
        'hallucination': 'eval.hallucination',
    };
    return categoryMap[category.toLowerCase()] || 'eval.general';
}
//-----------------------
// Metric Recording
//-----------------------
/**
 * Records an assistant evaluation metric.
 *
 * @param input The evaluation input data
 * @param durationMs How long the evaluation took (response time)
 * @param isElectronApp Whether running in Electron or Chromium
 * @param logger Logger for recording status
 */
async function recordAssistantEval(input, durationMs, isElectronApp, logger) {
    const toolsCalled = input.toolsCalled ?? parseToolsFromResponse(input.response);
    const context = {
        test_id: input.testId,
        test_description: input.description,
        test_category: input.category,
        language: input.language,
        model_key: input.modelKey,
        model_display_name: input.modelDisplayName,
        chat_mode: input.mode,
        grade: input.grade,
        grade_explanation: input.gradeExplanation,
        response_length: input.response.length,
        response_empty: !input.response.trim(),
        tools_called: toolsCalled,
        tool_count: toolsCalled.length,
        required_criteria_count: input.requiredCriteriaCount ?? 0,
        optional_criteria_count: input.optionalCriteriaCount ?? 0,
        failif_criteria_count: input.failIfCriteriaCount ?? 0,
        tags: input.tags ?? [],
        prompt: input.prompt,
    };
    const metric = {
        feature_area: 'assistant',
        action: 'eval_response',
        target_type: getCategoryTargetType(input.category),
        target_description: `${input.modelKey}: ${input.testId}`,
        duration_ms: durationMs,
        status: input.grade === 'I' ? 'error' : 'success',
        context_json: context,
    };
    try {
        await (0, api_js_1.logMetric)(metric, isElectronApp, logger);
    }
    catch (error) {
        logger.log('Warning: Failed to log assistant metric:', error);
    }
}
/**
 * Wraps an async operation and records it as an assistant eval metric.
 * Returns both the operation result and the duration.
 *
 * @param operation The async operation (typically the test run + evaluation)
 * @param getInput Function to extract metric input from the operation result
 * @param isElectronApp Whether running in Electron
 * @param logger Logger instance
 */
async function recordAssistantEvalWithTiming(operation, getInput, isElectronApp, logger) {
    const startTime = Date.now();
    const result = await operation();
    const durationMs = Date.now() - startTime;
    const input = getInput(result, durationMs);
    await recordAssistantEval(input, durationMs, isElectronApp, logger);
    return { result, duration_ms: durationMs };
}
//# sourceMappingURL=metric-assistant.js.map