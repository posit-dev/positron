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
	question: string;
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
	const { testId, description, model, grade, explanation, question, response } = params;
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
		'## Prompt',
		'```',
		question,
		'```',
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

/**
 * Formats test results as HTML for Playwright report attachment.
 *
 * @param params - The test result parameters
 * @returns Formatted HTML string
 */
export function formatResultsHtml(params: PrintResultsParams): string {
	const { testId, description, model, grade, explanation, question, response } = params;
	const toolsCalled = parseToolsCalled(response);
	const resultSymbol = grade === 'I' ? '✗' : '✓';
	const gradeLabel = GRADE_LABELS[grade];

	// Color based on grade
	const headerBg = grade === 'I' ? '#ef4444' : grade === 'P' ? '#f59e0b' : '#22c55e';

	const toolsList = toolsCalled.length > 0
		? `<ul style="margin: 0; padding-left: 20px;">${toolsCalled.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
		: '<em>none</em>';

	const truncatedResponse = response.length > 2000
		? response.substring(0, 2000) + '\n... [truncated]'
		: response;

	return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 16px; background: #f9fafb; }
		.container { max-width: 800px; margin: 0 auto; }
		.header { background: ${headerBg}; color: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; }
		.header h1 { margin: 0 0 8px 0; font-size: 1.5rem; }
		.header .meta { opacity: 0.9; font-size: 0.9rem; }
		.section { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
		.section h2 { margin: 0 0 12px 0; font-size: 1rem; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
		.section p { margin: 0; color: #4b5563; line-height: 1.6; }
		pre { background: #1f2937; color: #e5e7eb; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; white-space: pre-wrap; word-wrap: break-word; }
	</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>${escapeHtml(testId)} ${resultSymbol}</h1>
		<div class="meta"><strong>Result:</strong> ${gradeLabel} &nbsp;|&nbsp; <strong>Model:</strong> ${escapeHtml(model)}</div>
	</div>

	<div class="section">
		<h2>Description</h2>
		<p>${escapeHtml(description)}</p>
	</div>

	<div class="section">
		<h2>Tools Called</h2>
		${toolsList}
	</div>

	<div class="section">
		<h2>Evaluation</h2>
		${formatEvaluationHtml(explanation)}
	</div>

	<div class="section">
		<h2>Prompt</h2>
		<pre>${escapeHtml(question)}</pre>
	</div>

	<div class="section">
		<h2>Response</h2>
		<pre>${escapeHtml(truncatedResponse)}</pre>
	</div>
</div>
</body>
</html>`;
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Criterion type from LLM grader output
 * E = Essential (required), A = Additional (optional), F = Fail-if (auto-fail)
 */
type CriterionType = 'E' | 'A' | 'F' | 'unknown';

/**
 * Type labels for display
 */
const TYPE_LABELS: Record<CriterionType, string> = {
	'E': 'Required',
	'A': 'Optional',
	'F': 'Fail if',
	'unknown': '—',
};

/**
 * Parses the evaluation explanation into structured parts.
 * Format: "Type  Criterion  Met? ——— E text1 ✓ A text2 ✓ F text3 ✗ Summary text..."
 * Note: checkmarks (✓/✗) come AFTER the criterion text
 */
function parseEvaluation(explanation: string): { criteria: Array<{ text: string; met: boolean; type: CriterionType }>; explanation: string } {
	const criteria: Array<{ text: string; met: boolean; type: CriterionType }> = [];
	let explanationText = '';

	// Remove header lines and any leading dashes (various unicode dash characters)
	const text = explanation
		.replace(/^Type\s+Criterion.*$/im, '')  // Remove "Type  Criterion  Met?" header
		.replace(/^Criteria Met\?/i, '')  // Legacy format
		.replace(/^[\s\u002D\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D─────]+/gm, '')  // Remove whitespace and all dash variants
		.replace(/Type legend:.*$/im, '')  // Remove legend line
		.trim();

	// Split by checkmarks - keeps the delimiters
	const segments = text.split(/([✓✗])/);

	for (let i = 0; i < segments.length - 1; i += 2) {
		let criterionText = segments[i].trim();
		const checkmark = segments[i + 1];

		// Skip if:
		// - Text is too short
		// - Text contains "Criteria" or "Type" (header remnant)
		// - Text contains sequences of 3+ dashes (separator line)
		const hasCriteriaWord = /criteria/i.test(criterionText);
		const hasTypeWord = /^type\s/i.test(criterionText);
		const hasManyDashes = /[-—─–―]{3,}/.test(criterionText);

		if (criterionText &&
			criterionText.length > 3 &&
			!hasCriteriaWord &&
			!hasTypeWord &&
			!hasManyDashes &&
			(checkmark === '✓' || checkmark === '✗')) {

			// Try to extract type prefix (E, A, F at the start)
			let type: CriterionType = 'unknown';
			const typeMatch = criterionText.match(/^([EAF])\s+/);
			if (typeMatch) {
				type = typeMatch[1] as CriterionType;
				criterionText = criterionText.substring(typeMatch[0].length).trim();
			}

			criteria.push({
				text: criterionText,
				met: checkmark === '✓',
				type
			});
		}
	}

	// The last segment (after the last checkmark) is the explanation/summary
	if (segments.length > 0) {
		const lastSegment = segments[segments.length - 1].trim();
		if (lastSegment && lastSegment.length > 3) {
			explanationText = lastSegment;
		}
	}

	return { criteria, explanation: explanationText };
}

/**
 * Get color for criterion type badge
 */
function getTypeColor(type: CriterionType): { bg: string; text: string } {
	switch (type) {
		case 'E': return { bg: '#dbeafe', text: '#1e40af' };  // Blue for required
		case 'A': return { bg: '#f3f4f6', text: '#6b7280' };  // Gray for optional
		case 'F': return { bg: '#fef2f2', text: '#dc2626' };  // Red for fail-if
		default: return { bg: '#f3f4f6', text: '#6b7280' };
	}
}

/**
 * Formats the evaluation section as HTML with a criteria table.
 */
function formatEvaluationHtml(explanation: string): string {
	const parsed = parseEvaluation(explanation);

	if (parsed.criteria.length === 0) {
		// No structured criteria found, just show the explanation
		return `<p>${escapeHtml(explanation)}</p>`;
	}

	const criteriaRows = parsed.criteria.map(c => {
		const typeColor = getTypeColor(c.type);
		const typeLabel = TYPE_LABELS[c.type];
		return `
		<tr>
			<td style="padding: 8px; text-align: center; border-bottom: 1px solid #e5e7eb; color: ${c.met ? '#22c55e' : '#ef4444'}; font-weight: bold;">${c.met ? '✓' : '✗'}</td>
			<td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">
				<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 500; background: ${typeColor.bg}; color: ${typeColor.text};">${typeLabel}</span>
			</td>
			<td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(c.text)}</td>
		</tr>
	`;
	}).join('');

	const summaryHtml = parsed.explanation
		? `<p style="margin-bottom: 12px; color: #374151;">${escapeHtml(parsed.explanation)}</p>`
		: '';

	return `
		${summaryHtml}
		<table style="width: 100%; border-collapse: collapse;">
			<thead>
				<tr style="background: #f3f4f6;">
					<th style="padding: 8px; text-align: center; border-bottom: 2px solid #e5e7eb; width: 50px;">Pass</th>
					<th style="padding: 8px; text-align: left; border-bottom: 2px solid #e5e7eb; width: 80px;">Type</th>
					<th style="padding: 8px; text-align: left; border-bottom: 2px solid #e5e7eb;">Criterion</th>
				</tr>
			</thead>
			<tbody>
				${criteriaRows}
			</tbody>
		</table>
	`;
}
