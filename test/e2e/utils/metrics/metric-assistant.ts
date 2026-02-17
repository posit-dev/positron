/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiLogger } from '../../infra/logger.js';
import { BaseMetric, MetricResult, MetricTargetType, AssistantEvalMetricInput } from './metric-base.js';
import { logMetric } from './api.js';

//-----------------------
// Feature-specific Types
//-----------------------

export type AssistantAction = 'eval_response';

export type AssistantTargetType = Extract<MetricTargetType, `eval.${string}`>;

export type AssistantGrade = 'C' | 'P' | 'I';

export type AssistantChatMode = 'Ask' | 'Edit' | 'Agent';

// Re-export for convenience
export type AssistantEvalInput = AssistantEvalMetricInput;

/**
 * Extended context for assistant evaluation metrics.
 * Captures comprehensive data for dashboard analytics and QueryChat.
 */
export interface AssistantMetricContext {
	// Test identification
	test_id: string;
	test_description: string;
	test_category: string;
	language?: 'R' | 'Python';

	// Model information
	model_key: string;
	model_display_name: string;
	chat_mode: AssistantChatMode;

	// Evaluation results
	grade: AssistantGrade;
	grade_explanation: string;

	// Response analysis
	response_length: number;
	response_empty: boolean;
	tools_called: string[];
	tool_count: number;

	// Criteria breakdown
	required_criteria_count: number;
	optional_criteria_count: number;
	failif_criteria_count: number;

	// Test tags for filtering
	tags: string[];

	// The prompt sent to the assistant
	prompt: string;
}

export type AssistantMetric = BaseMetric & {
	feature_area: 'assistant';
	action: AssistantAction;
	context_json: AssistantMetricContext;
};

//-----------------------
// Helper Functions
//-----------------------

/**
 * Parses tools called from the assistant response.
 * Extracts tool names from "Tools called: tool1, tool2" format.
 */
export function parseToolsFromResponse(response: string): string[] {
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
export function getCategoryTargetType(category: string): AssistantTargetType {
	const categoryMap: Record<string, AssistantTargetType> = {
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
export async function recordAssistantEval(
	input: AssistantEvalInput,
	durationMs: number,
	isElectronApp: boolean,
	logger: MultiLogger
): Promise<void> {
	const toolsCalled = input.toolsCalled ?? parseToolsFromResponse(input.response);

	const context: AssistantMetricContext = {
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

	const metric: AssistantMetric = {
		feature_area: 'assistant',
		action: 'eval_response',
		target_type: getCategoryTargetType(input.category),
		target_description: `${input.modelKey}: ${input.testId}`,
		duration_ms: durationMs,
		status: input.grade === 'I' ? 'error' : 'success',
		context_json: context,
	};

	try {
		await logMetric(metric, isElectronApp, logger);
	} catch (error) {
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
export async function recordAssistantEvalWithTiming<T>(
	operation: () => Promise<T>,
	getInput: (result: T, durationMs: number) => AssistantEvalInput,
	isElectronApp: boolean,
	logger: MultiLogger
): Promise<MetricResult<T>> {
	const startTime = Date.now();
	const result = await operation();
	const durationMs = Date.now() - startTime;

	const input = getInput(result, durationMs);
	await recordAssistantEval(input, durationMs, isElectronApp, logger);

	return { result, duration_ms: durationMs };
}
