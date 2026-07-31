/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IEditorPane } from '../../../../common/editor.js';
import { ITextQuery, QueryType } from '../../../../services/search/common/search.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../../positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../positronNotebook/common/positronNotebookCommon.js';
import { ICellMatch, IMatchInNotebook, INotebookFileInstanceMatch } from '../../browser/notebookSearch/notebookSearchModelBase.js';
import { ISearchableNotebookCell, openSearchMatchInPositronNotebook, searchPositronNotebooks } from '../../browser/notebookSearch/positronNotebookSearch.js';
import { CellSearchModel } from '../../common/cellSearchModel.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

const notebookUri = URI.file('/workspace/analysis.ipynb');
const getComparisonKey = (uri: URI) => uri.toString();

function makeQuery(pattern: string, overrides: Partial<ITextQuery['contentPattern']> = {}, queryOverrides: Partial<ITextQuery> = {}): ITextQuery {
	return {
		type: QueryType.Text,
		contentPattern: { pattern, ...overrides },
		folderQueries: [],
		...queryOverrides,
	};
}

describe('searchPositronNotebooks', () => {
	const disposables = ensureNoLeakedDisposables();

	/** Build a searchable cell from plain strings, reusing CellSearchModel for the text buffer. */
	function makeCell(source: string, opts: { cellKind?: CellKind; outputs?: string[] } = {}): ISearchableNotebookCell {
		const bufferSource = disposables.add(new CellSearchModel(source, undefined, []));
		const outputs = (opts.outputs ?? []).map(output => ({
			outputs: [{ mime: 'text/plain', data: VSBuffer.fromString(output) }],
		}));
		return {
			cellKind: opts.cellKind ?? CellKind.Code,
			textBuffer: bufferSource.inputTextBuffer,
			outputs,
		};
	}

	it('produces cell-based matches with ranges relative to the cell source', () => {
		const notebook = {
			uri: notebookUri,
			cells: [
				makeCell('# Setup dataframe\ndf = pd.DataFrame({})'),
				makeCell('print("no hits here")'),
				makeCell('new_df = pd.DataFrame({})'),
			],
		};

		const { results, limitHit } = searchPositronNotebooks(makeQuery('DataFrame'), [notebook], getComparisonKey);

		expect(limitHit).toBe(false);
		const fileMatch = results.get(notebookUri);
		expect(fileMatch?.cellResults.map(cell => ({
			index: cell.index,
			previews: cell.contentResults.map(match => match.previewText),
			// Project ranges to plain tuples: [startLine, startCol, endLine, endCol], 0-based within the cell.
			ranges: cell.contentResults.flatMap(match => match.rangeLocations.map(location =>
				[location.source.startLineNumber, location.source.startColumn, location.source.endLineNumber, location.source.endColumn])),
		}))).toMatchInlineSnapshot(`
			[
			  {
			    "index": 0,
			    "previews": [
			      "# Setup dataframe
			",
			      "df = pd.DataFrame({})
			",
			    ],
			    "ranges": [
			      [
			        0,
			        8,
			        0,
			        17,
			      ],
			      [
			        1,
			        8,
			        1,
			        17,
			      ],
			    ],
			  },
			  {
			    "index": 2,
			    "previews": [
			      "new_df = pd.DataFrame({})
			",
			    ],
			    "ranges": [
			      [
			        0,
			        12,
			        0,
			        21,
			      ],
			    ],
			  },
			]
		`);
	});

	it('maps notebooks without matches to null so raw JSON results are still suppressed', () => {
		const notebook = { uri: notebookUri, cells: [makeCell('print(1)')] };

		const { results } = searchPositronNotebooks(makeQuery('DataFrame'), [notebook], getComparisonKey);

		expect(results.has(notebookUri)).toBe(true);
		expect(results.get(notebookUri)).toBeNull();
	});

	it('skips notebooks excluded by the query include pattern', () => {
		const notebook = { uri: notebookUri, cells: [makeCell('df = pd.DataFrame({})')] };
		const query = makeQuery('DataFrame', {}, { includePattern: { '**/*.py': true } });

		const { results } = searchPositronNotebooks(query, [notebook], getComparisonKey);

		expect(results.has(notebookUri)).toBe(false);
	});

	it('honors case sensitivity, regex, and whole-word flags', () => {
		const notebook = { uri: notebookUri, cells: [makeCell('Dataframe dataframes df_dataframe')] };

		const caseSensitive = searchPositronNotebooks(makeQuery('dataframe', { isCaseSensitive: true }), [notebook], getComparisonKey);
		expect(caseSensitive.results.get(notebookUri)?.cellResults[0].contentResults[0].rangeLocations).toHaveLength(2);

		const regex = searchPositronNotebooks(makeQuery('data\\w+s\\b', { isRegExp: true }), [notebook], getComparisonKey);
		expect(regex.results.get(notebookUri)?.cellResults[0].contentResults[0].rangeLocations).toHaveLength(1);

		const wholeWord = searchPositronNotebooks(makeQuery('Dataframe', { isWordMatch: true }), [notebook], getComparisonKey);
		expect(wholeWord.results.get(notebookUri)?.cellResults[0].contentResults[0].rangeLocations).toHaveLength(1);
	});

	it('honors the notebook input filters', () => {
		const notebook = {
			uri: notebookUri,
			cells: [
				makeCell('# dataframe notes', { cellKind: CellKind.Markup }),
				makeCell('df = dataframe()'),
			],
		};
		const query = makeQuery('dataframe', {
			notebookInfo: {
				isInNotebookMarkdownInput: false,
				isInNotebookMarkdownPreview: false,
				isInNotebookCellInput: true,
				isInNotebookCellOutput: false,
			},
		});

		const { results } = searchPositronNotebooks(query, [notebook], getComparisonKey);

		expect(results.get(notebookUri)?.cellResults.map(cell => cell.index)).toEqual([1]);
	});

	it('searches cell outputs and marks them as webview matches', () => {
		const notebook = {
			uri: notebookUri,
			cells: [makeCell('print(df)', { outputs: ['   a  dataframe\n0  1  2'] })],
		};

		const { results } = searchPositronNotebooks(makeQuery('dataframe'), [notebook], getComparisonKey);

		const cellResult = results.get(notebookUri)?.cellResults[0];
		expect(cellResult?.contentResults).toHaveLength(0);
		expect(cellResult?.webviewResults.map(match => ({ preview: match.previewText, webviewIndex: match.webviewIndex }))).toEqual([
			{ preview: '   a  dataframe\n', webviewIndex: 0 },
		]);
	});

	it('reports limitHit and stops once maxResults is reached', () => {
		const manyMatches = Array.from({ length: 5 }, () => 'dataframe').join('\n');
		const first = { uri: notebookUri, cells: [makeCell(manyMatches)] };
		const second = { uri: URI.file('/workspace/other.ipynb'), cells: [makeCell('dataframe')] };
		const query = makeQuery('dataframe', {}, { maxResults: 2 });

		const { results, limitHit } = searchPositronNotebooks(query, [first, second], getComparisonKey);

		expect(limitHit).toBe(true);
		expect(results.has(second.uri)).toBe(false);
	});

	it('searches each notebook model once even when open in multiple editors', () => {
		const notebook = { uri: notebookUri, cells: [makeCell('dataframe')] };

		const { results } = searchPositronNotebooks(makeQuery('dataframe'), [notebook, notebook], getComparisonKey);

		expect(results.size).toBe(1);
	});
});

describe('openSearchMatchInPositronNotebook', () => {
	function makeMatch(overrides: Partial<IMatchInNotebook> = {}): IMatchInNotebook {
		return stubInterface<IMatchInNotebook>({
			parent: () => stubInterface<INotebookFileInstanceMatch>(),
			cellParent: stubInterface<ICellMatch>(),
			isWebviewMatch: () => false,
			cellIndex: 0,
			webviewIndex: undefined,
			cell: undefined,
			range: () => new Range(2, 3, 2, 9),
			...overrides,
		});
	}

	function makePane(cell: IPositronNotebookCell): IEditorPane {
		const instance = stubInterface<IPositronNotebookInstance>({
			cells: observableValue('cells', [cell]),
		});
		// `notebookInstance` is how getNotebookInstanceFromEditorPane reads the
		// instance off a Positron notebook editor pane; it is not part of
		// IEditorPane, hence the cast (matches notebookUndoRedo.vitest.ts).
		// eslint-disable-next-line local/code-no-dangerous-type-assertions -- modeling PositronNotebookEditor's `notebookInstance` field on a structurally-stubbed IEditorPane (production code casts the same way)
		const overrides = { getId: () => POSITRON_NOTEBOOK_EDITOR_ID, notebookInstance: instance } as unknown as Partial<IEditorPane>;
		return stubInterface<IEditorPane>(overrides);
	}

	it('selects the match range in the cell editor', async () => {
		const cell = stubInterface<IPositronNotebookCell>({
			uri: notebookUri.with({ scheme: 'vscode-notebook-cell', fragment: 'cell0' }),
			setOptions: vi.fn(async () => { }),
		});

		await openSearchMatchInPositronNotebook(makePane(cell), makeMatch(), false);

		expect(cell.setOptions).toHaveBeenCalledWith({
			cellOptions: {
				resource: cell.uri,
				options: {
					preserveFocus: false,
					selection: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 9 },
				},
			},
		});
	});

	it('reveals the cell without selecting for webview (output) matches', async () => {
		const cell = stubInterface<IPositronNotebookCell>({
			reveal: vi.fn(async () => true),
			setOptions: vi.fn(async () => { }),
		});

		await openSearchMatchInPositronNotebook(makePane(cell), makeMatch({ isWebviewMatch: () => true, webviewIndex: 0 }), false);

		expect(cell.reveal).toHaveBeenCalledWith({ reason: 'programmatic' });
		expect(cell.setOptions).not.toHaveBeenCalled();
	});

	it('is a no-op for panes that are not Positron notebook editors', async () => {
		const pane = stubInterface<IEditorPane>({ getId: () => 'workbench.editor.someOtherEditor' });

		await expect(openSearchMatchInPositronNotebook(pane, makeMatch(), false)).resolves.toBeUndefined();
	});

	it('is a no-op for elements that are not notebook matches', async () => {
		const cell = stubInterface<IPositronNotebookCell>({
			setOptions: vi.fn(async () => { }),
		});
		// A plain text match: no cellParent/cellIndex, so isIMatchInNotebook rejects it.
		const element = stubInterface<IMatchInNotebook>({
			parent: () => stubInterface<INotebookFileInstanceMatch>(),
			cellParent: undefined,
		});

		await openSearchMatchInPositronNotebook(makePane(cell), element, false);

		expect(cell.setOptions).not.toHaveBeenCalled();
	});
});
