/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grade labels for display.
 */
export const GRADE_LABELS: Record<string, string> = {
	'C': 'complete',
	'P': 'partial',
	'I': 'incomplete',
};

/**
 * Parameters for printing test results.
 */
export interface PrintResultsParams {
	testId: string;
	description: string;
	model: string;
	grade: 'C' | 'P' | 'I';
	explanation: string;
	response: string;
}

/**
 * Parses the "Tools Called:" section from an LLM response.
 * Handles both newline-separated and comma-separated formats.
 */
function parseToolsCalled(response: string): string[] {
	const toolsMatch = response.match(/Tools [Cc]alled:\s*([\s\S]*?)(?=\n\n|$)/i);
	if (!toolsMatch) {
		return [];
	}

	const toolsText = toolsMatch[1].trim();

	// Check if comma-separated (single line) or newline-separated
	if (toolsText.includes(',') && !toolsText.includes('\n')) {
		return toolsText.split(',').map(t => t.trim()).filter(t => t);
	}

	// Newline-separated format (with optional bullets)
	return toolsText.split('\n')
		.map(t => t.replace(/^[-*•]\s*/, '').trim())
		.filter(t => t);
}

/**
 * Formats test results as markdown for Playwright report attachment.
 *
 * @param params - The test result parameters
 * @returns Formatted markdown string
 */
export function formatResultsMarkdown(params: PrintResultsParams): string {
	const { testId, description, model, grade, explanation, response } = params;
	const toolsCalled = parseToolsCalled(response);
	const resultSymbol = grade === 'I' ? '❌' : '✅';

	const lines: string[] = [
		`# ${testId}`,
		'',
		`**Result:** ${GRADE_LABELS[grade]} ${resultSymbol}`,
		`**Model:** ${model}`,
		'',
		'## Description',
		description,
		'',
		'## Tools Called',
		toolsCalled.length > 0
			? toolsCalled.map(t => `- ${t}`).join('\n')
			: '_none_',
		'',
		'## Evaluation',
		explanation,
		'',
		'## Response',
		'```',
		response.length > 2000
			? response.substring(0, 2000) + '\n... [truncated]'
			: response,
		'```',
	];

	return lines.join('\n');
}
