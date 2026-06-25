/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { truncate } from '../../../../../base/common/strings.js';
import { ChatModeKind } from '../../../chat/common/constants.js';
import { StreamingTagLexer } from '../../../../common/positron/streamingTagLexer.js';
import { INotebookCellDTO, INotebookContextDTO, NotebookCellType } from '../../../../common/positron/notebookAssistant.js';
import { IHeadlessLanguageModelService, IStreamTextRequest, intentFromSetting } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';

/**
 * The notebook-suggestions consumer. The headless LM service does not own
 * prompts, context, or parsing; this module builds the prompt and context from
 * the notebook DTO the assistant panel already loaded, drives the service's
 * stream, and parses the XML response into the action suggestions the panel
 * renders.
 */

/** System prompt preserved from the existing notebook-suggestions feature. */
export const NOTEBOOK_SUGGESTIONS_SYSTEM_PROMPT = `You are an AI assistant for Jupyter notebooks in Positron. Your task is to analyze the provided notebook context and suggest 3-5 specific, actionable tasks that the user might want to perform with their notebook.

## Guidelines

1. **Be Contextual**: Base suggestions on the actual state of the notebook (execution status, errors, outputs, cell content, etc.)
2. **Be Specific**: Suggestions should reference specific aspects of the notebook (e.g., "Debug the error in cell 5" not just "Debug errors")
3. **Be Actionable**: Each suggestion should be something the assistant can help with immediately
4. **Vary Modes**: Use appropriate modes:
- \`ask\`: For questions, explanations, or information requests
- \`edit\`: For code modifications, refactoring, or adding content
- \`agent\`: For complex tasks that may require multiple steps or tool usage
5. **Prioritize Issues**: If there are errors or failed cells, prioritize debugging suggestions
6. **Consider Workflow**: Suggest next logical steps based on what has been executed

## Output Format

You MUST return only valid XML in the output, and nothing else. Format the response using the following structure:

\`\`\`xml
<suggestions>
<suggestion>
<label>Brief action title (max 50 chars)</label>
<detail>Longer explanation of what this action will do</detail>
<query>The full prompt that will be sent to the assistant to execute this action</query>
<mode>ask</mode>
</suggestion>
<suggestion>
<label>Another action title</label>
<detail>Another explanation</detail>
<query>Another prompt</query>
<mode>edit</mode>
</suggestion>
</suggestions>
\`\`\`

Valid values for mode are: \`ask\`, \`edit\`, or \`agent\`

## Examples

### Example 1: Notebook with Failed Cell

Context: Notebook has 10 cells, cell 5 failed with a NameError, 3 cells selected

\`\`\`xml
<suggestions>
<suggestion>
<label>Debug the NameError in cell 5</label>
<detail>Investigate and fix the undefined variable causing the error</detail>
<query>Can you help me debug the NameError in cell 5 and suggest a fix?</query>
<mode>agent</mode>
</suggestion>
<suggestion>
<label>Explain the selected cells</label>
<detail>Get a detailed explanation of what the selected code does</detail>
<query>Can you explain what the code in the selected cells does?</query>
<mode>ask</mode>
</suggestion>
<suggestion>
<label>Add error handling</label>
<detail>Add try-catch blocks to make the code more robust</detail>
<query>Can you add error handling to the selected cells?</query>
<mode>edit</mode>
</suggestion>
</suggestions>
\`\`\`

### Example 2: Empty Notebook

Context: Notebook has 0 cells, Python kernel

\`\`\`xml
<suggestions>
<suggestion>
<label>Get started with data analysis</label>
<detail>Create a basic data analysis workflow with pandas</detail>
<query>Can you help me set up a basic data analysis workflow with pandas? Please create cells for loading data, exploring it, and visualizing it.</query>
<mode>agent</mode>
</suggestion>
<suggestion>
<label>Create a data science template</label>
<detail>Set up a standard data science notebook structure</detail>
<query>Can you create a template notebook structure for data science work with sections for imports, data loading, exploration, modeling, and conclusions?</query>
<mode>edit</mode>
</suggestion>
</suggestions>
\`\`\`

### Example 3: Notebook with Outputs

Context: Notebook has 15 cells, all executed successfully, last cell shows a matplotlib plot, 0 cells selected

\`\`\`xml
<suggestions>
<suggestion>
<label>Explain the visualization</label>
<detail>Get insights about the plot in the last cell</detail>
<query>Can you explain what the visualization in the last cell shows and what insights we can draw from it?</query>
<mode>ask</mode>
</suggestion>
<suggestion>
<label>Improve the plot aesthetics</label>
<detail>Enhance the visual appearance of the matplotlib plot</detail>
<query>Can you suggest improvements to make the plot in the last cell more visually appealing and publication-ready?</query>
<mode>edit</mode>
</suggestion>
<suggestion>
<label>Add summary statistics</label>
<detail>Create a new cell with statistical analysis of the plotted data</detail>
<query>Can you add a cell that calculates and displays summary statistics for the data shown in the plot?</query>
<mode>agent</mode>
</suggestion>
<suggestion>
<label>Export results to file</label>
<detail>Save the plot and data to files</detail>
<query>Can you help me export the visualization and underlying data to files?</query>
<mode>agent</mode>
</suggestion>
</suggestions>
\`\`\`

Remember: Return ONLY valid XML. Do not include any explanatory text, markdown formatting, or additional commentary.`;

/** A single notebook action suggestion, rendered as a button in the panel. */
export interface INotebookSuggestion {
	readonly label: string;
	readonly detail?: string;
	readonly query: string;
	readonly mode: ChatModeKind;
	readonly iconClass?: string;
}

/** Valid XML tag names in the suggestions response. */
type SuggestionTag = 'suggestions' | 'suggestion' | 'label' | 'detail' | 'query' | 'mode' | 'iconClass';

/** The maximum suggestions to keep; the model is asked for 3-5. */
const MAX_SUGGESTIONS = 5;

// ponytail: cap cells to bound prompt size; add sliding-window (#14479-style) if huge notebooks regress.
const MAX_CONTEXT_CELLS = 50;
const MAX_CELL_CONTENT = 1000;

/**
 * Build the context message sent to the model from the notebook DTO the
 * assistant panel already holds. Reads only the LLM-relevant fields
 * (kernel language, per-cell content, type, selection, and execution status);
 * UI-only fields like `editorShown` are ignored. If a future consumer needs a
 * materially different context, give it its own builder rather than widening
 * this one or the DTO.
 */
export function buildSuggestionsContext(context: INotebookContextDTO, maxCells: number = MAX_CONTEXT_CELLS): string {
	const parts: string[] = [];

	parts.push('## Notebook Context');
	parts.push(`- Kernel language: ${context.kernelLanguage ?? 'unknown'}`);
	parts.push(`- Cell count: ${context.cellCount}`);
	if (context.runtimeState) {
		parts.push(`- Runtime state: ${context.runtimeState}`);
	}
	parts.push('');

	const cells = context.allCells ?? context.selectedCells;
	if (!cells || cells.length === 0) {
		parts.push('The notebook has no cells yet.');
		return parts.join('\n');
	}

	parts.push('## Cells');
	for (const cell of cells.slice(0, maxCells)) {
		parts.push(formatCell(cell));
	}
	if (cells.length > maxCells) {
		parts.push(`... and ${cells.length - maxCells} more cells.`);
	}

	parts.push('');
	parts.push('Based on this context, suggest 3-5 specific, actionable tasks.');

	return parts.join('\n');
}

/** Format one cell as a compact markdown block for the prompt. */
function formatCell(cell: INotebookCellDTO): string {
	const status: string[] = [cell.type, cell.selectionStatus];
	if (cell.type === NotebookCellType.Code) {
		if (cell.lastRunSuccess === false) {
			status.push('failed');
		} else if (cell.executionStatus && cell.executionStatus !== 'idle') {
			status.push(cell.executionStatus);
		}
		if (cell.hasOutput) {
			status.push('has output');
		}
	}
	return [
		`### Cell ${cell.index + 1} (${status.join(', ')})`,
		'```',
		truncate(cell.content, MAX_CELL_CONTENT, '...'),
		'```',
	].join('\n');
}

/**
 * Generate notebook action suggestions through the headless LM service. Builds
 * the request, streams the response, and parses the suggestions, reporting the
 * running list via `onProgress` as each one arrives.
 *
 * Returns the parsed suggestions (an empty array is a valid "nothing useful"
 * result). Throws if the service cannot proceed (no providers, sign-in needed,
 * etc.) or the stream fails -- the caller shows a single error notification.
 */
export async function generateNotebookSuggestions(
	service: IHeadlessLanguageModelService,
	context: INotebookContextDTO,
	modelSetting: readonly string[] | undefined,
	token: CancellationToken,
	onProgress: (suggestions: INotebookSuggestion[]) => void,
): Promise<INotebookSuggestion[]> {
	const request: IStreamTextRequest = {
		systemPrompt: NOTEBOOK_SUGGESTIONS_SYSTEM_PROMPT,
		messages: [{ role: 'user', content: buildSuggestionsContext(context) }],
		model: intentFromSetting(modelSetting),
		cancellationToken: token,
	};
	const result = await service.streamText(request);
	if (!result.available) {
		throw new Error(result.reason);
	}
	return parseNotebookSuggestions(result.text, onProgress, token);
}

/**
 * Parse the streamed XML suggestions, reporting the running list as each
 * suggestion closes. Caps at {@link MAX_SUGGESTIONS}. Returns the suggestions
 * (possibly empty). Throws if the stream itself fails.
 *
 * Drives the shared {@link StreamingTagLexer} over the `<suggestions>` schema.
 * A field tag left open when its suggestion closes is flushed; a new
 * `<suggestion>` opening while a field is still open resets the stale field
 * state (tolerating malformed XML). Text outside a recognized field is dropped.
 *
 * @internal Exported for focused testing; callers should use
 * {@link generateNotebookSuggestions}.
 */
export async function parseNotebookSuggestions(
	text: AsyncIterable<string>,
	onProgress: (suggestions: INotebookSuggestion[]) => void,
	token: CancellationToken,
): Promise<INotebookSuggestion[]> {
	const suggestions: INotebookSuggestion[] = [];
	let current: Partial<Record<SuggestionTag, string>> | null = null;
	let currentField: SuggestionTag | null = null;
	let currentFieldContent = '';

	const lexer = new StreamingTagLexer<SuggestionTag>({
		tagNames: ['suggestions', 'suggestion', 'label', 'detail', 'query', 'mode', 'iconClass'],
		contentHandler: chunk => {
			if (chunk.type === 'tag') {
				if (chunk.name === 'suggestion') {
					if (chunk.kind === 'open') {
						// Reset any field left open by malformed XML.
						currentField = null;
						currentFieldContent = '';
						current = {};
					} else if (chunk.kind === 'close' && current) {
						// Flush a field that opened but never closed.
						if (currentField && currentFieldContent.trim()) {
							current[currentField] = currentFieldContent.trim();
							currentField = null;
							currentFieldContent = '';
						}
						const completed = completeSuggestion(current);
						if (completed && suggestions.length < MAX_SUGGESTIONS) {
							suggestions.push(completed);
							onProgress([...suggestions]);
						}
						current = null;
					}
				} else if (chunk.name !== 'suggestions') {
					if (chunk.kind === 'open') {
						currentField = chunk.name;
						currentFieldContent = '';
					} else if (chunk.kind === 'close' && currentField && current) {
						current[currentField] = currentFieldContent.trim();
						currentField = null;
						currentFieldContent = '';
					}
				}
			} else if (currentField) {
				currentFieldContent += chunk.text;
			}
		},
	});

	for await (const chunk of text) {
		if (token.isCancellationRequested) {
			return suggestions;
		}
		await lexer.process(chunk);
	}
	await lexer.flush();

	return suggestions;
}

/** Validate a partial suggestion: require label + query, normalize the mode. */
function completeSuggestion(partial: Partial<Record<SuggestionTag, string>>): INotebookSuggestion | null {
	if (!partial.label || !partial.query) {
		return null;
	}
	return {
		label: partial.label,
		detail: partial.detail,
		query: partial.query,
		mode: normalizeMode(partial.mode),
		iconClass: partial.iconClass,
	};
}

/** Map a raw mode string to a {@link ChatModeKind}, defaulting to Agent. */
function normalizeMode(mode: string | undefined): ChatModeKind {
	switch (mode) {
		case 'ask': return ChatModeKind.Ask;
		case 'edit': return ChatModeKind.Edit;
		default: return ChatModeKind.Agent;
	}
}
