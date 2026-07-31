/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceMap, ResourceSet } from '../../../../../base/common/map.js';
import { Schemas } from '../../../../../base/common/network.js';
import { isNumber } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { USUAL_WORD_SEPARATORS } from '../../../../../editor/common/core/wordHelper.js';
import { FindMatch, IReadonlyTextBuffer, SearchData } from '../../../../../editor/common/model.js';
import { SearchParams } from '../../../../../editor/common/model/textModelSearch.js';
import { IEditorPane } from '../../../../common/editor.js';
import { DEFAULT_MAX_SEARCH_RESULTS, ITextQuery, ITextSearchMatch, pathIncludedInQuery } from '../../../../services/search/common/search.js';
import { CellKind, IOutputItemDto } from '../../../notebook/common/notebookCommon.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { getNotebookInstanceFromEditorPane } from '../../../positronNotebook/browser/notebookUtils.js';
import { CellSearchModel } from '../../common/cellSearchModel.js';
import { genericCellMatchesToTextSearchMatches, INotebookCellMatchNoModel, INotebookFileMatchNoModel } from '../../common/searchNotebookHelpers.js';
import { ISearchTreeMatch } from '../searchTreeModel/searchTreeCommon.js';
import { isIMatchInNotebook } from './notebookSearchModelBase.js';

/**
 * The subset of NotebookTextModel that the Positron notebook search reads.
 * Narrow on purpose so tests can construct models without the DI-heavy
 * NotebookTextModel class.
 */
export interface ISearchableNotebook {
	readonly uri: URI;
	readonly cells: readonly ISearchableNotebookCell[];
}

/** The subset of NotebookCellTextModel that the Positron notebook search reads. */
export interface ISearchableNotebookCell {
	readonly cellKind: CellKind;
	readonly textBuffer: IReadonlyTextBuffer;
	readonly outputs: readonly ISearchableCellOutput[];
}

/** The subset of a cell output (ICellOutput) that the Positron notebook search reads. */
export interface ISearchableCellOutput {
	readonly outputs: readonly IOutputItemDto[];
}

/** Search results for notebooks resolved in the renderer, keyed by notebook URI. */
export interface IPositronNotebookSearchResults {
	/**
	 * A file match per searched notebook. Notebooks that were searched but had
	 * no matches map to null so callers still know to suppress the raw JSON
	 * results for those files.
	 */
	results: ResourceMap<INotebookFileMatchNoModel | null>;
	limitHit: boolean;
}

/**
 * URI schemes whose notebooks are searched cell-by-cell. Restricted to
 * user-editable notebook files so internal notebook documents (e.g. interactive
 * windows) don't surface in search results.
 */
const SEARCHABLE_NOTEBOOK_SCHEMES = new Set<string>([Schemas.file, Schemas.vscodeRemote, Schemas.untitled]);

/**
 * Notebook models resolved in the renderer that the Positron notebook search
 * should cover. When Positron notebooks are the frontend, open notebooks are
 * not NotebookEditorWidgets, so the upstream open-notebook search misses them.
 * Their NotebookTextModels are resolved through the notebook service though,
 * so searching those models yields cell-based results that reflect unsaved edits.
 * @param skipFiles Files already covered by the widget-based open-notebook search.
 */
export function getPositronSearchableNotebooks(notebookService: INotebookService, skipFiles: ResourceSet): ISearchableNotebook[] {
	return notebookService.listNotebookDocuments()
		.filter(model => SEARCHABLE_NOTEBOOK_SCHEMES.has(model.uri.scheme) && !skipFiles.has(model.uri));
}

/**
 * Search notebook models cell-by-cell, honoring the query's regex, case,
 * whole-word, and notebook input/output filters.
 * @returns Cell-based matches per notebook, ready to feed into the search view
 * as INotebookFileMatchNoModel results.
 */
export function searchPositronNotebooks(
	query: ITextQuery,
	notebooks: readonly ISearchableNotebook[],
	getComparisonKey: (uri: URI) => string,
): IPositronNotebookSearchResults {
	const results = new ResourceMap<INotebookFileMatchNoModel | null>(getComparisonKey);
	let limitHit = false;

	const searchData = parseQuerySearchData(query);
	if (!searchData) {
		return { results, limitHit };
	}

	const askMax = (isNumber(query.maxResults) ? query.maxResults : DEFAULT_MAX_SEARCH_RESULTS) + 1;
	let numResults = 0;

	for (const notebook of notebooks) {
		// Multiple editors can share a notebook model; search each model once.
		if (results.has(notebook.uri)) {
			continue;
		}
		if (!pathIncludedInQuery(query, notebook.uri.fsPath)) {
			continue;
		}

		const { cellResults, matchCount } = searchNotebookCells(notebook, query, searchData, askMax - numResults);
		numResults += matchCount;
		if (numResults >= askMax) {
			limitHit = true;
		}

		results.set(notebook.uri, cellResults.length > 0 ? { resource: notebook.uri, cellResults } : null);

		if (limitHit) {
			break;
		}
	}

	return { results, limitHit };
}

/** Build the text-buffer search request from the query's pattern and flags. */
function parseQuerySearchData(query: ITextQuery): SearchData | null {
	const pattern = query.contentPattern;
	const searchParams = new SearchParams(
		pattern.pattern,
		pattern.isRegExp ?? false,
		pattern.isCaseSensitive ?? false,
		pattern.isWordMatch ? (pattern.wordSeparators ?? USUAL_WORD_SEPARATORS) : null,
	);
	return searchParams.parseSearchRequest();
}

/** Search one notebook's cell inputs and outputs, up to maxMatches matches. */
function searchNotebookCells(
	notebook: ISearchableNotebook,
	query: ITextQuery,
	searchData: SearchData,
	maxMatches: number,
): { cellResults: INotebookCellMatchNoModel[]; matchCount: number } {
	// Honor the search view's notebook filters (defaulting to "search everything",
	// matching the upstream open-notebook search).
	const notebookInfo = query.contentPattern.notebookInfo;
	const includeMarkupInput = notebookInfo?.isInNotebookMarkdownInput ?? true;
	const includeCodeInput = notebookInfo?.isInNotebookCellInput ?? true;
	const includeOutput = notebookInfo?.isInNotebookCellOutput ?? true;

	const cellResults: INotebookCellMatchNoModel[] = [];
	let matchCount = 0;

	for (let index = 0; index < notebook.cells.length; index++) {
		if (matchCount >= maxMatches) {
			break;
		}
		const cell = notebook.cells[index];
		const isMarkup = cell.cellKind === CellKind.Markup;

		// Search the cell source.
		let contentResults: ITextSearchMatch[] = [];
		let inputMatchCount = 0;
		if (isMarkup ? includeMarkupInput : includeCodeInput) {
			const inputMatches = findMatchesInBuffer(cell.textBuffer, searchData);
			inputMatchCount = inputMatches.length;
			contentResults = genericCellMatchesToTextSearchMatches(inputMatches, cell.textBuffer);
		}

		// Search the cell outputs, mirroring the extension host's closed-notebook search.
		let webviewResults: ITextSearchMatch[] = [];
		if (includeOutput && !isMarkup && cell.outputs.length > 0) {
			const outputs = cell.outputs.flatMap(output => output.outputs.map(item => item.data.toString()));
			const cellModel = new CellSearchModel('', undefined, outputs);
			try {
				webviewResults = cellModel.outputTextBuffers
					.flatMap(buffer => {
						const outputMatches = findMatchesInBuffer(buffer, searchData);
						return outputMatches.length > 0 ? genericCellMatchesToTextSearchMatches(outputMatches, buffer) : [];
					})
					.map((textMatch, webviewIndex) => {
						textMatch.webviewIndex = webviewIndex;
						return textMatch;
					});
			} finally {
				cellModel.dispose();
			}
		}

		if (contentResults.length > 0 || webviewResults.length > 0) {
			matchCount += inputMatchCount + webviewResults.length;
			cellResults.push({ index, contentResults, webviewResults });
		}
	}

	return { cellResults, matchCount };
}

/** Find all matches in a text buffer (capped like the upstream cell search). */
function findMatchesInBuffer(buffer: IReadonlyTextBuffer, searchData: SearchData): FindMatch[] {
	const lineCount = buffer.getLineCount();
	const fullRange = new Range(1, 1, lineCount, buffer.getLineLength(lineCount) + 1);
	return buffer.findMatchesLineByLine(fullRange, searchData, true, 5000);
}

/**
 * Reveal a search match in a Positron notebook editor pane: scroll the cell
 * into view and select the matched range in the cell's editor.
 *
 * No-op when the pane is not a Positron notebook editor or the element is not
 * a notebook match, so callers can invoke it unconditionally after opening an
 * editor for a search result.
 */
export async function openSearchMatchInPositronNotebook(editorPane: IEditorPane | undefined, element: ISearchTreeMatch, preserveFocus?: boolean): Promise<void> {
	const instance = getNotebookInstanceFromEditorPane(editorPane);
	if (!instance || !isIMatchInNotebook(element)) {
		return;
	}

	const cell = instance.cells.get()[element.cellIndex];
	if (!cell) {
		return;
	}

	if (element.isWebviewMatch()) {
		// Output matches have no cell editor range to select; just bring the cell into view.
		await cell.reveal({ reason: 'programmatic' });
		return;
	}

	// Match ranges are relative to the cell's source, so they can be applied
	// directly as the cell editor's selection.
	const range = element.range();
	await cell.setOptions({
		cellOptions: {
			resource: cell.uri,
			options: {
				preserveFocus,
				selection: {
					startLineNumber: range.startLineNumber,
					startColumn: range.startColumn,
					endLineNumber: range.endLineNumber,
					endColumn: range.endColumn,
				},
			},
		},
	});
}
