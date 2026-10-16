/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { truncate } from '../../../../base/common/strings.js';
import { ISuggestionsRequest, SUGGESTIONS_OUTPUT_FORMAT, SUGGESTIONS_REMINDER } from '../../positronNotebook/browser/AssistantPanel/notebookSuggestions.js';

/** System prompt for Quarto document suggestions. */
const QUARTO_SUGGESTIONS_SYSTEM_PROMPT = `You are an AI assistant for Quarto documents in Positron. Your task is to analyze the provided Quarto document and suggest 3-5 specific, actionable tasks that the user might want to perform with their document.

## Guidelines

1. **Be Contextual**: Base suggestions on the actual content of the document (prose, code chunks, chunk options, YAML front matter, etc.)
2. **Be Specific**: Suggestions should reference specific aspects of the document (e.g., "Add a caption to the plot in the 'results' section" not just "Improve plots")
3. **Be Actionable**: Each suggestion should be something the assistant can help with immediately
4. **Vary Modes**: Use appropriate modes:
- \`ask\`: For questions, explanations, or information requests
- \`edit\`: For code modifications, refactoring, or adding content
- \`agent\`: For complex tasks that may require multiple steps or tool usage
5. **Consider Workflow**: Suggest next logical steps for the analysis or the written report

${SUGGESTIONS_OUTPUT_FORMAT}

${SUGGESTIONS_REMINDER}`;

// Cap the document source to bound prompt size.
const MAX_DOCUMENT_CONTENT = 20_000;

/**
 * Build the suggestions request for a Quarto document from its source text.
 */
export function buildQuartoSuggestionsRequest(source: string, language: string | undefined, codeCellCount: number): ISuggestionsRequest {
	const context = [
		'## Document Context',
		`- Primary language: ${language ?? 'unknown'}`,
		`- Code chunk count: ${codeCellCount}`,
		'',
		'## Source',
		'````',
		truncate(source, MAX_DOCUMENT_CONTENT, '...'),
		'````',
		'',
		'Based on this context, suggest 3-5 specific, actionable tasks.',
	].join('\n');
	return { systemPrompt: QUARTO_SUGGESTIONS_SYSTEM_PROMPT, context };
}
