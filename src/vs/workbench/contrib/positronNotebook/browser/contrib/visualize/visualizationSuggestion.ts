/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { raceTimeout } from '../../../../../../base/common/async.js';
import { truncate } from '../../../../../../base/common/strings.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { IHeadlessLanguageModelService, IStreamTextRequest, intentFromSetting } from '../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { ChartType, VizLibrary } from './generateVizCode.js';
import { DataFrameColumn, VisualizationSuggestion } from './visualizeModalDialog.js';

/**
 * The visualize-dataframe consumer. The headless LM service does not own
 * prompts, context, or parsing; this module builds the prompt from the notebook
 * cells, drives the service's stream, and parses the JSON suggestion the
 * visualize wizard prefills from.
 */

/** Bound the whole generation so a black-holed stream can't hang the wizard. */
const GENERATION_TIMEOUT_MS = 30_000;

/** System prompt preserved from the existing visualize feature. */
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

/**
 * Generate a visualization suggestion through the headless LM service. Builds
 * the request from the notebook cells, streams the response, and parses the
 * JSON suggestion.
 *
 * Returns the parsed suggestion, or `null` when the service cannot proceed, the
 * generation times out, or the response does not parse -- the wizard treats
 * null as "fall through to manual selection", so there is no error to surface.
 */
export async function generateVisualizationSuggestion(
	service: IHeadlessLanguageModelService,
	cells: readonly IPositronNotebookCell[],
	executedIndex: number,
	dfName: string,
	columns: readonly DataFrameColumn[],
	modelSetting: readonly string[] | undefined,
	token: CancellationToken,
): Promise<VisualizationSuggestion | null> {
	if (executedIndex < 0 || executedIndex >= cells.length) {
		return null;
	}

	const request: IStreamTextRequest = {
		systemPrompt: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: buildVisualizationContext(cells, executedIndex, dfName, columns) }],
		model: intentFromSetting(modelSetting),
		cancellationToken: token,
	};

	const result = await service.streamText(request);
	if (!result.available) {
		return null;
	}

	const fullText = await raceTimeout(collect(result.text), GENERATION_TIMEOUT_MS);
	if (fullText === undefined || token.isCancellationRequested) {
		return null;
	}

	const parsed = parseVisualizationSuggestion(fullText, columns);
	if (!parsed) {
		return null;
	}
	parsed.modelName = result.model.name;
	return parsed;
}

/** Collect a text stream into a single string. */
async function collect(text: AsyncIterable<string>): Promise<string> {
	let out = '';
	for await (const chunk of text) {
		out += chunk;
	}
	return out;
}

/**
 * Build the context message sent to the model: the dataframe variable and
 * columns, the just-executed cell, and a few previous cells for import context.
 * User-controlled fields (dfName, column names/types) are JSON-stringified so
 * embedded newlines / quotes can't smuggle prompt instructions in; the parser
 * allow-list (library / chart enums and column-name membership) is the
 * authoritative trust boundary -- this is defence in depth.
 */
export function buildVisualizationContext(
	cells: readonly IPositronNotebookCell[],
	executedIndex: number,
	dfName: string,
	columns: readonly DataFrameColumn[],
): string {
	// V1 is Python-only (the Visualize action gates non-Python surfaces), so the
	// fence language is always python.
	const lang = 'python';
	const parts: string[] = [];

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
	parts.push('```' + lang);
	parts.push(truncate(cells[executedIndex].getContent(), 1000, '...'));
	parts.push('```');
	parts.push('');

	const prevToInclude = Math.min(5, executedIndex);
	if (prevToInclude > 0) {
		parts.push(`## Previous cells (last ${prevToInclude}, for library / import context)`);
		for (let i = executedIndex - prevToInclude; i < executedIndex; i++) {
			const cell = cells[i];
			if (!cell.isCodeCell()) { continue; }
			parts.push(`Cell ${i + 1}:`);
			parts.push('```' + lang);
			parts.push(truncate(cell.getContent(), 400, '...'));
			parts.push('```');
		}
		parts.push('');
	}

	parts.push('Return the JSON now. Do not wrap it in markdown or add commentary.');
	return parts.join('\n');
}

/**
 * Parse the JSON visualization suggestion out of the model's response,
 * tolerating markdown fences and surrounding prose, and coercing the library /
 * chart type / columns against the provided allow-lists. Returns null on any
 * failure.
 *
 * @internal Exported for focused testing; callers should use
 * {@link generateVisualizationSuggestion}.
 */
export function parseVisualizationSuggestion(
	raw: string,
	columns: readonly DataFrameColumn[],
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
		return null;
	}
	const jsonText = cleaned.substring(firstBrace, lastBrace + 1);

	let obj: unknown;
	try {
		obj = JSON.parse(jsonText);
	} catch {
		return null;
	}

	if (typeof obj !== 'object' || obj === null) { return null; }
	const o = obj as Record<string, unknown>;

	const library = coerceLibrary(o.library);
	const chartType = coerceChartType(o.chartType);
	if (!library || !chartType) {
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
		return null;
	}
	const yCol = yColRaw && columnNames.has(yColRaw) ? yColRaw : null;

	const reasoningObj = (typeof o.reasoning === 'object' && o.reasoning !== null)
		? o.reasoning as Record<string, unknown>
		: {};
	const reasoning = {
		library: typeof reasoningObj.library === 'string' ? reasoningObj.library : '',
		chartType: typeof reasoningObj.chartType === 'string' ? reasoningObj.chartType : '',
		columns: typeof reasoningObj.columns === 'string' ? reasoningObj.columns : '',
	};

	return { library, chartType, xCol, yCol, reasoning };
}

function coerceLibrary(v: unknown): VizLibrary | null {
	return v === 'plotly' || v === 'matplotlib' || v === 'seaborn' ? v : null;
}

function coerceChartType(v: unknown): ChartType | null {
	return v === 'bar' || v === 'line' || v === 'scatter' || v === 'histogram' ? v : null;
}
