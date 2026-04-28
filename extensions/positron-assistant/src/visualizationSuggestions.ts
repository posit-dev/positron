/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { ParticipantService } from './participants.js';
import { isFileExcludedFromAI } from './fileExclusion.js';
import { raceTimeout } from './asyncUtils.js';

const MODEL_SELECTION_TIMEOUT_MS = 10_000;
const GENERATION_TIMEOUT_MS = 30_000;

/**
 * IMPORTANT: `VisualizationSuggestion` is mirrored on the workbench side in
 *   src/vs/workbench/contrib/positronNotebook/browser/contrib/visualize/visualizeModalDialog.tsx
 *
 * The two copies are not byte-identical -- the workbench imports `VizLibrary`
 * and `ChartType` from `generateVizCode.js`, while this file declares
 * `VizLibrary` and `VizChartType` locally. The allow-list literals and the
 * field shape must stay identical on both sides; the workbench copy is
 * validated at the IPC boundary as defence in depth. When adding a field
 * or changing a literal, update BOTH.
 */
type VizLibrary = 'plotly' | 'matplotlib' | 'seaborn';
type VizChartType = 'bar' | 'line' | 'scatter' | 'histogram';

interface VizReasoning {
	library: string;
	chartType: string;
	columns: string;
}

export interface VisualizationSuggestion {
	library: VizLibrary;
	chartType: VizChartType;
	xCol: string;
	yCol: string | null;
	reasoning: VizReasoning;
	modelName?: string;
}

interface InputColumn {
	name: string;
	type: string;
}

const SYSTEM_PROMPT = `You are a data visualization expert helping a user explore a dataframe inside a Positron notebook.

The user is opening a "Visualize" wizard on a dataframe output in a Python notebook cell. V1 is Python-only -- do not suggest R, Julia, or any non-Python library. Based on:
- the notebook code and output context
- the dataframe's columns and dtypes
- any imports already present in the notebook

Suggest the most useful first visualization.

Rules:
1. Only Python plotting libraries are supported in V1: plotly, matplotlib, seaborn.
2. Prefer a library that is ALREADY imported in the notebook. If none is imported, pick the most ergonomic one for the data shape.
3. The chart type should suit the column dtypes (e.g. histogram for a single numeric column, scatter for two numerics, bar for a categorical vs numeric).
4. Pick xCol (and yCol if appropriate) from the provided column list. For histograms, leave yCol as null.
5. Keep each reasoning to one concise sentence that a user can scan in under two seconds. Reference concrete context ("the notebook already imports plotly.express", "uniform is numeric so a histogram shows its distribution").

Return ONLY valid JSON matching this TypeScript type, with no prose or markdown fences:

{
\t"library": "plotly" | "matplotlib" | "seaborn",
\t"chartType": "bar" | "line" | "scatter" | "histogram",
\t"xCol": string,            // must be one of the provided column names
\t"yCol": string | null,     // must be a column name or null
\t"reasoning": {
\t\t"library":   string,     // one sentence
\t\t"chartType": string,     // one sentence
\t\t"columns":   string      // one sentence
\t}
}`;

export async function generateVisualizationSuggestion(
	notebookUri: string,
	executedCellIndex: number,
	dfName: string,
	columns: InputColumn[],
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
	token: vscode.CancellationToken,
): Promise<VisualizationSuggestion | null> {
	const uri = vscode.Uri.parse(notebookUri);
	const notebook = vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === uri.toString());
	if (!notebook) {
		log.warn('[viz-suggest] Notebook not found', notebookUri);
		return null;
	}
	if (isFileExcludedFromAI(uri)) {
		log.debug('[viz-suggest] Notebook excluded from AI features');
		return null;
	}
	if (executedCellIndex < 0 || executedCellIndex >= notebook.cellCount) {
		log.warn('[viz-suggest] Invalid cell index', executedCellIndex);
		return null;
	}

	// V1 only supports Python. Bail out quietly for other languages so the
	// dialog falls through to manual selection.
	const cellLang = notebook.cellAt(executedCellIndex).document.languageId;
	if (cellLang !== 'python') {
		log.debug(`[viz-suggest] Skipping non-Python cell (language: ${cellLang})`);
		return null;
	}

	const modelSelectionCts = new vscode.CancellationTokenSource();
	const cancelListener = token.onCancellationRequested(() => modelSelectionCts.cancel());
	let modelSelection: { model: vscode.LanguageModelChat } | null | undefined;
	try {
		modelSelection = await raceTimeout(
			getModel(participantService, log, modelSelectionCts.token),
			MODEL_SELECTION_TIMEOUT_MS,
			() => modelSelectionCts.cancel(),
		);
	} finally {
		cancelListener.dispose();
		modelSelectionCts.dispose();
	}
	if (!modelSelection) {
		log.warn('[viz-suggest] No language model available');
		return null;
	}
	const { model } = modelSelection;

	const contextMessage = buildContextMessage(notebook, executedCellIndex, dfName, columns);

	const generationCts = new vscode.CancellationTokenSource();
	const parentCancelListener = token.onCancellationRequested(() => generationCts.cancel());
	// Guard the case where the parent token is already cancelled before the
	// listener registered above could observe it.
	if (token.isCancellationRequested) { generationCts.cancel(); }
	try {
		const messages = [
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.System, SYSTEM_PROMPT),
			vscode.LanguageModelChatMessage.User(contextMessage),
		];
		const fullText = await raceTimeout(
			(async () => {
				const response = await model.sendRequest(messages, {}, generationCts.token);
				let out = '';
				for await (const chunk of response.text) {
					if (generationCts.token.isCancellationRequested) { return undefined; }
					out += chunk;
				}
				return out;
			})(),
			GENERATION_TIMEOUT_MS,
			() => generationCts.cancel(),
		);
		if (fullText === undefined || token.isCancellationRequested) {
			log.warn('[viz-suggest] Generation did not complete (timeout or cancellation)');
			return null;
		}
		const parsed = parseVizSuggestion(fullText, columns, log);
		if (!parsed) { return null; }
		parsed.modelName = model.name;
		return parsed;
	} catch (error) {
		if (token.isCancellationRequested) { return null; }
		log.error(`[viz-suggest] Error generating suggestion: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	} finally {
		parentCancelListener.dispose();
		generationCts.dispose();
	}
}

function buildContextMessage(
	notebook: vscode.NotebookDocument,
	executedCellIndex: number,
	dfName: string,
	columns: InputColumn[],
): string {
	const parts: string[] = [];
	// User-controlled fields (dfName, column names, column types) are
	// JSON-stringified so embedded newlines / quotes can't smuggle prompt
	// instructions into the system. The parser allow-list (library / chart
	// enums and column-name membership) is the authoritative trust boundary;
	// this is defence in depth.
	parts.push('## Dataframe');
	parts.push(`- Variable: ${JSON.stringify(dfName)}`);
	parts.push(`- Column count: ${columns.length}`);
	if (columns.length) {
		parts.push('- Columns:');
		for (const c of columns) {
			parts.push(`  - ${JSON.stringify(c.name)} (${JSON.stringify(c.type)})`);
		}
	}
	parts.push('');

	parts.push('## Just-executed cell');
	const executedCell = notebook.cellAt(executedCellIndex);
	parts.push('```' + executedCell.document.languageId);
	parts.push(truncate(executedCell.document.getText(), 1000));
	parts.push('```');
	parts.push('');

	const prevToInclude = Math.min(5, executedCellIndex);
	if (prevToInclude > 0) {
		parts.push(`## Previous cells (last ${prevToInclude}, for library / import context)`);
		for (let i = executedCellIndex - prevToInclude; i < executedCellIndex; i++) {
			const cell = notebook.cellAt(i);
			if (cell.kind !== vscode.NotebookCellKind.Code) { continue; }
			parts.push(`Cell ${i + 1}:`);
			parts.push('```' + cell.document.languageId);
			parts.push(truncate(cell.document.getText(), 400));
			parts.push('```');
		}
		parts.push('');
	}

	parts.push('Return the JSON now. Do not wrap it in markdown or add commentary.');
	return parts.join('\n');
}

function truncate(text: string, max: number): string {
	if (text.length <= max) { return text; }
	return text.substring(0, max) + '...';
}

export function parseVizSuggestion(
	raw: string,
	columns: InputColumn[],
	log: vscode.LogOutputChannel,
): VisualizationSuggestion | null {
	// Strip code fences if the model added them.
	const cleaned = raw
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/```\s*$/, '')
		.trim();

	// Extract first {...} block if the model wrapped it with prose.
	const firstBrace = cleaned.indexOf('{');
	const lastBrace = cleaned.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
		log.warn('[viz-suggest] No JSON object found in response');
		return null;
	}
	const jsonText = cleaned.substring(firstBrace, lastBrace + 1);

	let obj: unknown;
	try {
		obj = JSON.parse(jsonText);
	} catch (err) {
		log.warn(`[viz-suggest] Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}

	if (typeof obj !== 'object' || obj === null) { return null; }
	const o = obj as Record<string, unknown>;

	const library = coerceLibrary(o.library);
	const chartType = coerceChartType(o.chartType);
	if (!library || !chartType) {
		log.warn('[viz-suggest] Invalid library or chartType in response');
		return null;
	}

	const columnNames = new Set(columns.map(c => c.name));
	const xColRaw = typeof o.xCol === 'string' ? o.xCol : '';
	const yColRaw = typeof o.yCol === 'string' ? o.yCol : null;

	let xCol: string;
	if (columnNames.has(xColRaw)) {
		xCol = xColRaw;
	} else if (columns.length > 0) {
		xCol = columns[0].name;
	} else {
		log.warn('[viz-suggest] Rejecting suggestion: no valid xCol and no columns to fall back to');
		return null;
	}
	const yCol = yColRaw && columnNames.has(yColRaw) ? yColRaw : null;

	const reasoningObj = (typeof o.reasoning === 'object' && o.reasoning !== null)
		? o.reasoning as Record<string, unknown>
		: {};
	const reasoning: VizReasoning = {
		library: typeof reasoningObj.library === 'string' ? reasoningObj.library : '',
		chartType: typeof reasoningObj.chartType === 'string' ? reasoningObj.chartType : '',
		columns: typeof reasoningObj.columns === 'string' ? reasoningObj.columns : '',
	};

	return { library, chartType, xCol, yCol, reasoning };
}

function coerceLibrary(v: unknown): VizLibrary | null {
	return v === 'plotly' || v === 'matplotlib' || v === 'seaborn' ? v : null;
}

function coerceChartType(v: unknown): VizChartType | null {
	return v === 'bar' || v === 'line' || v === 'scatter' || v === 'histogram' ? v : null;
}

interface ModelSelectionResult {
	model: vscode.LanguageModelChat;
}

// Simplified version of the model selection used by ghost cells. Ghost
// cells can be disabled per-model via user configuration (because they
// fire on every edit). Visualize is user-initiated, so it ignores that
// allow/deny list and uses whichever model the user currently has
// selected, falling back to the default provider.
async function getModel(
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
	token: vscode.CancellationToken,
): Promise<ModelSelectionResult | null> {
	const sessionModelId = participantService.getCurrentSessionModel();
	if (sessionModelId) {
		const models = await vscode.lm.selectChatModels({ id: sessionModelId });
		if (token.isCancellationRequested) { return null; }
		if (models && models.length > 0) {
			log.debug(`[viz-suggest] Using session model: ${models[0].name}`);
			return { model: models[0] };
		}
	}

	if (token.isCancellationRequested) { return null; }
	const currentProvider = await positron.ai.getCurrentProvider();
	if (token.isCancellationRequested) { return null; }
	if (currentProvider) {
		const models = await vscode.lm.selectChatModels({ vendor: currentProvider.id });
		if (token.isCancellationRequested) { return null; }
		if (models && models.length > 0) {
			log.debug(`[viz-suggest] Using provider model: ${models[0].name}`);
			return { model: models[0] };
		}
	}

	if (token.isCancellationRequested) { return null; }
	const [firstModel] = await vscode.lm.selectChatModels();
	if (token.isCancellationRequested) { return null; }
	if (firstModel) {
		log.debug(`[viz-suggest] Using fallback model: ${firstModel.name}`);
		return { model: firstModel };
	}

	return null;
}
