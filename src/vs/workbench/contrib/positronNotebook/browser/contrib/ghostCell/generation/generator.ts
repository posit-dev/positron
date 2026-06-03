/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../../base/common/cancellation.js';
import { hasKey } from '../../../../../../../base/common/types.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { localize } from '../../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../../../platform/log/common/log.js';
import { INotebookTextModel } from '../../../../../../contrib/notebook/common/notebookCommon.js';
import { IPositronLMService, ModelSelection } from '../../../../../../services/positronLM/common/positronLMService.js';
import { IPositronVariablesService } from '../../../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { StreamingTagLexer } from '../../../../../../services/positronLM/common/streamingTagLexer.js';
import { POSITRON_NOTEBOOK_GHOST_CELL_MAX_VARIABLES_KEY, POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY } from '../config.js';
import { buildNotebookLMContext, type VariableSnapshot } from '../../../../common/notebookLMContext.js';

// ===== Result Interface =====

export interface GhostCellResult {
	code: string;
	explanation: string;
	language: string;
	modelName?: string;
}

// ===== System Prompt =====

const GHOST_CELL_SYSTEM_PROMPT = `You are an AI assistant suggesting the next cell for a data science notebook in Positron. Your task is to analyze the just-executed cell and its output to suggest a single, focused next step.

## Guidelines

1. **Single Responsibility**: Each suggestion should do ONE thing. If you're tempted to chain multiple operations, pick the most valuable one.
2. **Be Actionable**: The suggested code should run immediately without modification
3. **Be Obvious**: Suggest the natural, low-friction next step - not a multi-step analysis pipeline
4. **Be Contextual**: Base your suggestion on what the user just executed and its results
5. **Use Available Variables**: When session variables are provided, reference actual variable names in your suggestion rather than guessing.

## Role Distinction

Ghost cell suggestions are for **quick, obvious next steps** that don't require discussion. Complex multi-step analyses, exploratory workflows, or anything that would benefit from user input belongs in the chat pane instead.

**Good for ghost cells:**
- A single inspection command (df.head(), df.describe())
- One refinement to existing code
- A quick diagnostic after an error

**Too complex for ghost cells (use chat instead):**
- Multi-step data cleaning pipelines
- Comprehensive EDA workflows
- Building and evaluating models together

## Common Next Steps by Context

- After data loading: One simple inspection (head, describe, shape, or info - pick one)
- After data exploration: One specific transformation or cleaning step
- After visualization: One refinement (title, labels, color, or style - pick one)
- After model training: One evaluation metric or diagnostic
- After an error: The most likely fix
- After calculations: One way to inspect or visualize the result

## Output Format

You MUST return only valid XML in the output, and nothing else. Use the following structure:

<suggestion>
<explanation>Brief description of what this code does and why it's a logical next step (1-2 sentences)</explanation>
<code>
# Comment explaining the suggestion
your_code_here()
</code>
</suggestion>

Remember: Return ONLY valid XML. Do not include any explanatory text, markdown formatting, or additional commentary outside the XML tags.`;

// ===== Generator =====

/**
 * Generates ghost cell suggestions by calling the LM service and parsing
 * structured XML output. This is the single entry point the controller uses.
 */
export class GhostCellGenerator {
	constructor(
		@IPositronLMService private readonly _lmService: IPositronLMService,
		@IPositronVariablesService private readonly _variablesService: IPositronVariablesService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) { }

	private _resolveVariables(): VariableSnapshot[] | undefined {
		const instance = this._variablesService.activePositronVariablesInstance;
		if (!instance) {
			return undefined;
		}
		const items = instance.variableItems;
		if (items.length === 0) {
			return undefined;
		}
		return items.map(v => ({ name: v.displayName, type: v.displayType }));
	}

	/**
	 * Generate a ghost cell suggestion for the cell at the given index.
	 *
	 * @param notebook The notebook text model
	 * @param _notebookUri The notebook URI (reserved for future use, e.g. file-exclusion checks)
	 * @param executedCellIndex Index of the cell that was just executed
	 * @param token Cancellation token
	 * @param onProgress Optional callback for streaming partial results
	 * @returns The result, or null if generation failed, was cancelled, or no model is available
	 */
	async generate(
		notebook: INotebookTextModel,
		_notebookUri: URI,
		executedCellIndex: number,
		token: CancellationToken,
		onProgress?: (partial: { code?: string; explanation?: string }) => void
	): Promise<GhostCellResult | null> {
		// Validate cell index
		if (executedCellIndex < 0 || executedCellIndex >= notebook.cells.length) {
			this._logService.warn('[ghost-cell-generator] Invalid cell index:', executedCellIndex);
			return null;
		}

		const cell = notebook.cells[executedCellIndex];
		const language = cell.language;

		// Build user message with full context
		const maxVariables = this._configurationService.getValue<number>(POSITRON_NOTEBOOK_GHOST_CELL_MAX_VARIABLES_KEY) ?? 20;
		const variables = this._resolveVariables();
		const ctx = buildNotebookLMContext(notebook, executedCellIndex, variables, { maxVariables });
		const content = ctx.toMarkdown() + 'Based on this context, suggest the most logical next cell for the user to execute.';

		// Determine model selection from ghost cell config
		const modelPatterns = this._configurationService.getValue<string[]>(POSITRON_NOTEBOOK_GHOST_CELL_MODEL_KEY);
		const model: ModelSelection | undefined = modelPatterns?.length
			? { patterns: modelPatterns }
			: undefined;

		// Stream from the LM service
		const streamResult = await this._lmService.streamText({
			systemPrompt: GHOST_CELL_SYSTEM_PROMPT,
			messages: [{ role: 'user', content }],
			cancellationToken: token,
			model,
		});

		if (hasKey(streamResult, { failure: true })) {
			this._logService.debug('[ghost-cell-generator] No language model available:', streamResult.failure);
			return null;
		}

		const { stream, modelName } = streamResult;

		// Parse the streaming XML response
		let explanation = '';
		let code = '';
		let currentField: 'explanation' | 'code' | null = null;
		let currentFieldContent = '';

		const lexer = new StreamingTagLexer({
			tagNames: ['suggestion', 'explanation', 'code'],
			contentHandler: chunk => {
				if (chunk.type === 'tag') {
					if (chunk.name === 'explanation' || chunk.name === 'code') {
						if (chunk.kind === 'open') {
							currentField = chunk.name;
							currentFieldContent = '';
						} else if (chunk.kind === 'close' && currentField) {
							if (currentField === 'explanation') {
								explanation = currentFieldContent.trim();
								onProgress?.({ explanation });
							} else if (currentField === 'code') {
								code = currentFieldContent.trim();
								onProgress?.({ code });
							}
							currentField = null;
							currentFieldContent = '';
						}
					}
				} else {
					// Accumulate text content for the current field
					if (currentField) {
						currentFieldContent += chunk.text;
						// Stream partial updates for code as it arrives
						if (currentField === 'code') {
							onProgress?.({ code: currentFieldContent.trim() });
						}
					}
				}
			}
		});

		try {
			for await (const chunk of stream) {
				if (token.isCancellationRequested) {
					return null;
				}
				await lexer.process(chunk);
			}

			// Flush any remaining buffered content
			await lexer.flush();
		} catch (error) {
			if (token.isCancellationRequested) {
				return null;
			}
			this._logService.error('[ghost-cell-generator] Error during streaming:', error);
			return null;
		}

		// Validate that we got code from the response
		if (!code) {
			this._logService.warn('[ghost-cell-generator] No code parsed from LM response');
			return null;
		}

		return {
			code,
			explanation: explanation || localize('positron.ghostCell.defaultExplanation', "Suggested next step"),
			language,
			modelName,
		};
	}
}
