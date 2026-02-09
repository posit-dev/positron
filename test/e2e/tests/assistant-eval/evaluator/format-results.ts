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
 * Prints formatted test results to the console.
 *
 * @param params - The test result parameters
 */
export function printTestResults(params: PrintResultsParams): void {
	const { testId, description, model, grade, explanation, response } = params;
	const toolsCalled = parseToolsCalled(response);

	const divider = '─'.repeat(50);
	const resultSymbol = grade === 'I' ? '✗' : '✓';

	console.log(`\n${divider}`);
	console.log(testId.toUpperCase());
	console.log(`result : ${GRADE_LABELS[grade]} ${resultSymbol}`);
	console.log(`model  : ${model}`);
	console.log(`${divider}\n`);

	console.log(`DESCRIPTION\n${description}\n`);

	console.log(`TOOLS CALLED`);
	if (toolsCalled.length > 0) {
		toolsCalled.forEach(tool => console.log(`• ${tool}`));
	} else {
		console.log(`none`);
	}
	console.log('');

	console.log(`EVALUATION\n${explanation}\n`);

	// Strip "Tools called:" from response for display (already shown above)
	const responseWithoutTools = response.replace(/\n*Tools [Cc]alled:.*$/s, '').trim();
	const truncatedResponse = responseWithoutTools.length > 600
		? responseWithoutTools.substring(0, 600) + '... [truncated]'
		: responseWithoutTools;
	console.log(`RESPONSE\n${truncatedResponse}\n`);
}
