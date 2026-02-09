/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { EvaluationCriteria, EvaluationResult } from '../test-cases/types';

/**
 * Model used for grading responses. Using a specific version for consistent evaluation.
 * Update this when adopting a newer Haiku release.
 */
const GRADER_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Parameters for LLM evaluation.
 */
interface EvaluateParams {
	/** The LLM response to evaluate */
	response: string;

	/** Criteria to evaluate against */
	criteria: EvaluationCriteria;

	/** Optional API key for the grader (falls back to ANTHROPIC_API_KEY env var) */
	apiKey?: string;
}

/**
 * Evaluates an LLM response against specified criteria using Claude Haiku.
 */
export async function evaluateWithLLM(params: EvaluateParams): Promise<EvaluationResult> {
	const { response, criteria, apiKey } = params;

	// Build the evaluation prompt
	const prompt = buildEvaluationPrompt(response, criteria);

	// Call Claude Haiku for evaluation
	const client = new Anthropic(apiKey ? { apiKey } : undefined);

	const message = await client.messages.create({
		model: GRADER_MODEL,
		max_tokens: 1024,
		messages: [{ role: 'user', content: prompt }],
	});

	// Extract the text content from the response
	const textContent = message.content.find(block => block.type === 'text');
	if (!textContent || textContent.type !== 'text') {
		throw new Error('No text response from evaluation model');
	}

	// Parse the grade from the response
	return parseEvaluationResponse(textContent.text);
}

/**
 * Builds the evaluation prompt.
 */
function buildEvaluationPrompt(response: string, criteria: EvaluationCriteria): string {
	const parts: string[] = [];

	parts.push(`You are an expert evaluator for checking how well LLMs respond and use tools in Positron Assistant.

CRITICAL INSTRUCTIONS:
1. Focus ENTIRELY on whether the response meets the specified criteria.
2. When criteria mention that specific tools must be called, look for them in a "Tools Called:" section in the response.
3. Be strict about ESSENTIAL criteria - all must be met for a Complete grade.
4. Check for FAIL IF conditions first - if any are present, grade is Incomplete regardless of other criteria.

GRADING SCALE:
- C (Complete): ALL essential criteria are met, and most additional criteria are met
- P (Partial): ALL essential criteria are met, but some additional criteria are missing
- I (Incomplete): ANY essential criteria are missing, OR any FAIL IF conditions are present`);

	parts.push(`\n\nRESPONSE TO EVALUATE:\n${response}`);

	parts.push(`\n\nESSENTIAL CRITERIA (ALL must be met for Complete or Partial):`);
	criteria.essential.forEach((c, i) => {
		parts.push(`${i + 1}. ${c}`);
	});

	if (criteria.additional && criteria.additional.length > 0) {
		parts.push(`\n\nADDITIONAL CRITERIA (most met = Complete, some met = Partial):`);
		criteria.additional.forEach((c, i) => {
			parts.push(`${i + 1}. ${c}`);
		});
	}

	if (criteria.failIf && criteria.failIf.length > 0) {
		parts.push(`\n\nAUTOMATIC FAIL IF (any of these = Incomplete):`);
		criteria.failIf.forEach((c, i) => {
			parts.push(`${i + 1}. ${c}`);
		});
	}

	parts.push(`\n\nProvide your evaluation in EXACTLY this format:
GRADE: [C/P/I]
EXPLANATION:
Show criteria results in a simple aligned table, then a brief summary:

Criteria                                    Met?
──────────────────────────────────────────  ────
[short criterion name, max 40 chars]        ✓ or ✗
...

[1-2 sentence summary of why this grade was given]`);

	return parts.join('\n');
}

/**
 * Parses the evaluation response to extract grade and explanation.
 */
function parseEvaluationResponse(responseText: string): EvaluationResult {
	// Extract grade using regex
	const gradeMatch = responseText.match(/GRADE:\s*([CPI])/i);
	if (!gradeMatch) {
		console.warn('Could not parse grade from evaluation response:', responseText);
		// Default to Incomplete if we can't parse
		return {
			grade: 'I',
			explanation: `Failed to parse evaluation response: ${responseText}`,
		};
	}

	const grade = gradeMatch[1].toUpperCase() as 'C' | 'P' | 'I';

	// Extract explanation
	const explanationMatch = responseText.match(/EXPLANATION:\s*(.+)/is);
	const explanation = explanationMatch
		? explanationMatch[1].trim()
		: 'No explanation provided';

	return { grade, explanation };
}

