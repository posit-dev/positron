/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { errorHandler } from '../../../../../base/common/errors.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { EndOfLineSequence, ITextModel } from '../../../../../editor/common/model.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { LanguageFeaturesService } from '../../../../../editor/common/services/languageFeaturesService.js';
import {
	DocumentFormattingEditProvider,
	DocumentRangeFormattingEditProvider,
	FormattingOptions,
	TextEdit,
} from '../../../../../editor/common/languages.js';
import { ILanguageConfigurationService, ResolvedLanguageConfiguration } from '../../../../../editor/common/languages/languageConfigurationRegistry.js';
import { IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IQuartoVirtualCell, IQuartoVirtualNotebookService } from '../../browser/quartoVirtualNotebookService.js';
import {
	provideQuartoCellFormattingEdits,
	provideQuartoCellRangeFormattingEdits,
} from '../../browser/quartoEmbeddedFormatting.js';

// The source document, with two Python chunks:
//
//    1  # Intro
//    2
//    3  ```{python}
//    4  #| label: a
//    5  import os
//    6  x  =  1
//    7  ```
//    8
//    9  ```{python}
//   10  y  =  2
//   11  ```
const SOURCE_URI = URI.file('/test/doc.qmd');
const CELL1_URI = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch0');
const CELL2_URI = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch1');

const CELL1_TEXT = '#| label: a\nimport os\nx  =  1';
const CELL2_TEXT = 'y  =  2';

/** An edit as a formatter hands one over. */
function edit(
	startLineNumber: number, startColumn: number,
	endLineNumber: number, endColumn: number,
	text: string
): TextEdit {
	return { range: { startLineNumber, startColumn, endLineNumber, endColumn }, text };
}

/** Edit list as strings, so an assertion reads without range boilerplate. */
function shapes(edits: readonly TextEdit[]): string[] {
	return edits.map(item =>
		`(${item.range.startLineNumber},${item.range.startColumn})-` +
		`(${item.range.endLineNumber},${item.range.endColumn}) -> ${JSON.stringify(item.text)}`);
}

describe('quartoEmbeddedFormatting', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	let languageFeatures: LanguageFeaturesService;
	let virtualNotebooks: IQuartoVirtualNotebookService;
	let languageConfiguration: ILanguageConfigurationService;
	let workerService: IEditorWorkerService;
	let calls: string[];
	let cells: IQuartoVirtualCell[];

	beforeEach(() => {
		calls = [];
		languageFeatures = new LanguageFeaturesService();

		// Formatter answers are minimized by the editor worker in production.
		// Edits pass through unchanged, so a failure points at the guards rather
		// than at a diff algorithm, with one exception copied faithfully from
		// `EditorWorker.$computeMoreMinimalEdits`: when any incoming edit carries
		// `eol`, the real worker appends a sentinel edit with a zero range. A
		// pass-through stub hides that, and a zero range is exactly what the
		// extension host refuses to convert.
		workerService = stubInterface<IEditorWorkerService>({
			computeMoreMinimalEdits: (_uri, edits) => {
				const carryingEol = edits?.find(candidate => typeof candidate.eol === 'number');
				const minimal: TextEdit[] = (edits ?? [])
					.map(candidate => ({ range: candidate.range, text: candidate.text }));
				if (carryingEol) {
					minimal.push({
						eol: carryingEol.eol,
						text: '',
						range: { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 },
					});
				}
				return Promise.resolve(minimal);
			},
		});

		languageConfiguration = stubInterface<ILanguageConfigurationService>({
			getLanguageConfiguration: () => stubInterface<ResolvedLanguageConfiguration>({
				comments: { lineCommentToken: '#' },
			}),
		});

		cells = [
			makeCell(CELL1_URI, 'python', CELL1_TEXT, 4, 6),
			makeCell(CELL2_URI, 'python', CELL2_TEXT, 10, 10),
		];

		virtualNotebooks = stubInterface<IQuartoVirtualNotebookService>({
			whenReady: () => Promise.resolve(),
			ensureSynchronized: () => { calls.push('ensureSynchronized'); },
			getCells: uri => uri.toString() === SOURCE_URI.toString() ? cells : [],
			getCellAtLine: (_uri, lineNumber) => cells.find(
				cell => lineNumber >= cell.codeStartLine && lineNumber <= cell.codeEndLine),
		});
	});

	function makeCell(
		cellUri: URI, language: string, text: string,
		codeStartLine: number, codeEndLine: number,
		options?: { indentSize: number }
	): IQuartoVirtualCell {
		const textModel: ITextModel = createTextModel(text, language, options, cellUri);
		ctx.disposables.add(textModel);
		return { cellUri, handle: 0, language, codeStartLine, codeEndLine, textModel };
	}

	/** Registers a document formatter that answers with `edits` for `language`. */
	function registerFormatter(
		language: string,
		name: string,
		answer: (model: ITextModel, options: FormattingOptions) => TextEdit[] | undefined
	): void {
		const provider: DocumentFormattingEditProvider = {
			provideDocumentFormattingEdits(model, options) {
				calls.push(name);
				return answer(model, options);
			},
		};
		ctx.disposables.add(
			languageFeatures.documentFormattingEditProvider.register({ language }, provider));
	}

	function registerRangeFormatter(
		language: string,
		name: string,
		answer: (model: ITextModel, range: IRange) => TextEdit[] | undefined
	): void {
		const provider: DocumentRangeFormattingEditProvider = {
			provideDocumentRangeFormattingEdits(model, range) {
				calls.push(name);
				return answer(model, range);
			},
		};
		ctx.disposables.add(
			languageFeatures.documentRangeFormattingEditProvider.register({ language }, provider));
	}

	function format(token: CancellationToken = CancellationToken.None) {
		return provideQuartoCellFormattingEdits(
			virtualNotebooks, languageFeatures, languageConfiguration,
			workerService, logService, SOURCE_URI, token);
	}

	function formatRange(range: IRange, token: CancellationToken = CancellationToken.None) {
		return provideQuartoCellRangeFormattingEdits(
			virtualNotebooks, languageFeatures, languageConfiguration,
			workerService, logService, SOURCE_URI, range, token);
	}

	describe('document formatting', () => {
		it('maps every cell answer into source coordinates, in document order', async () => {
			registerFormatter('python', 'formatter', model =>
				model.uri.toString() === CELL1_URI.toString()
					? [edit(3, 1, 3, 8, 'x = 1')]
					: [edit(1, 1, 1, 8, 'y = 2')]);

			const result = await format();

			expect({ edits: shapes(result.edits), vetoedCells: result.vetoedCells })
				.toEqual({
					edits: [
						// Cell 1 line 3 is source line 6, cell 2 line 1 is source line 10.
						'(6,1)-(6,8) -> "x = 1"',
						'(10,1)-(10,8) -> "y = 2"',
					],
					vetoedCells: 0,
				});
		});

		it('passes edit text through untouched and drops the worker\'s eol sentinel', async () => {
			// `eol` retargets a whole document's line endings, so one cell's
			// opinion of it must not reach the source file. The worker turns it into
			// a separate zero-range edit, which would map to column zero and make
			// the extension host reject the whole answer.
			registerFormatter('python', 'formatter', model =>
				model.uri.toString() === CELL1_URI.toString()
					? [{ ...edit(3, 1, 3, 8, 'x\t=\t1'), eol: EndOfLineSequence.CRLF }]
					: undefined);

			const result = await format();

			expect(result.edits).toMatchInlineSnapshot(`
				[
				  {
				    "range": {
				      "endColumn": 8,
				      "endLineNumber": 6,
				      "startColumn": 1,
				      "startLineNumber": 6,
				    },
				    "text": "x	=	1",
				  },
				]
			`);
		});

		it('skips a cell with no formatter without vetoing the others', async () => {
			cells = [
				makeCell(CELL1_URI, 'python', CELL1_TEXT, 4, 6),
				// No formatter is registered for R.
				makeCell(CELL2_URI, 'r', 'z<-1', 10, 10),
			];
			registerFormatter('python', 'python-formatter', () => [edit(3, 1, 3, 8, 'x = 1')]);

			const result = await format();

			expect({ edits: shapes(result.edits), vetoedCells: result.vetoedCells })
				.toEqual({ edits: ['(6,1)-(6,8) -> "x = 1"'], vetoedCells: 0 });
		});

		it('drops option-line rewrites and keeps the code edits beside them', async () => {
			// The shape posit-dev/positron#9432 is about: a formatter that
			// normalizes `#|` to `# |` while reformatting the code below it.
			registerFormatter('python', 'formatter', model =>
				model.uri.toString() === CELL1_URI.toString()
					? [edit(1, 2, 1, 2, ' '), edit(3, 1, 3, 8, 'x = 1')]
					: undefined);

			const result = await format();

			expect({ edits: shapes(result.edits), vetoedCells: result.vetoedCells })
				.toEqual({ edits: ['(6,1)-(6,8) -> "x = 1"'], vetoedCells: 0 });
		});

		it('vetoes the whole document when one cell would lose an option line', async () => {
			registerFormatter('python', 'formatter', model =>
				model.uri.toString() === CELL1_URI.toString()
					// Reaches from the option line into the code below it.
					? [edit(1, 1, 2, 1, '')]
					: [edit(1, 1, 1, 8, 'y = 2')]);

			const result = await format();

			// The healthy cell's edits are withheld too: a partial format is what
			// the Quarto extension refuses to apply as well.
			expect(result).toEqual({ edits: [], vetoedCells: 1 });
		});

		it('vetoes an answer that reaches past the end of the cell', async () => {
			registerFormatter('python', 'formatter', model =>
				model.uri.toString() === CELL2_URI.toString()
					// Cell 2 holds one line, so line 2 is the closing fence.
					? [edit(1, 1, 2, 1, 'y = 2\n')]
					: undefined);

			const result = await format();

			expect(result).toEqual({ edits: [], vetoedCells: 1 });
		});

		it('drops a trailing newline at the end of a cell and keeps its siblings', async () => {
			registerFormatter('python', 'formatter', model =>
				model.uri.toString() === CELL2_URI.toString()
					? [edit(1, 1, 1, 8, 'y = 2'), edit(1, 8, 1, 8, '\n')]
					: undefined);

			const result = await format();

			expect({ edits: shapes(result.edits), vetoedCells: result.vetoedCells })
				.toEqual({ edits: ['(10,1)-(10,8) -> "y = 2"'], vetoedCells: 0 });
		});

		it('contributes nothing, and does not veto, when only a trailing newline was offered', async () => {
			// The common case for an already-formatted chunk. Forwarding it would
			// grow the chunk by a blank line on every format.
			registerFormatter('python', 'formatter', model =>
				model.uri.toString() === CELL2_URI.toString()
					? [edit(1, 8, 1, 8, '\n')]
					: undefined);

			const result = await format();

			expect(result).toEqual({ edits: [], vetoedCells: 0 });
		});

		it('reaches a formatter that only registered for ranges', async () => {
			// TypeScript registers a range formatter and nothing else, and core
			// lifts such a provider to document scope. Without that lift those
			// chunks would format today and stop formatting natively.
			registerRangeFormatter('python', 'range-formatter', (model, range) => {
				expect(range).toEqual(model.getFullModelRange());
				return model.uri.toString() === CELL2_URI.toString()
					? [edit(1, 1, 1, 8, 'y = 2')]
					: undefined;
			});

			const result = await format();

			expect(shapes(result.edits)).toEqual(['(10,1)-(10,8) -> "y = 2"']);
		});

		it('takes the first answer for a cell and leaves the next provider alone', async () => {
			// One cell, and one with no option lines, so the answer is not touched
			// by the guards and this measures only which provider was asked.
			cells = [makeCell(CELL2_URI, 'python', CELL2_TEXT, 10, 10)];
			registerFormatter('python', 'second', () => [edit(1, 1, 1, 8, 'second')]);
			registerFormatter('python', 'first', () => [edit(1, 1, 1, 8, 'first')]);

			const result = await format();

			// `ordered()` puts the most recently registered provider first.
			expect({ edits: shapes(result.edits), called: calls.filter(c => c !== 'ensureSynchronized') })
				.toEqual({ edits: ['(10,1)-(10,8) -> "first"'], called: ['first'] });
		});

		it('formats each cell with that cell model\'s own options', async () => {
			// Per-language editor settings reach the cell model at creation, which
			// is where the Quarto extension has to read them by hand instead.
			//
			// `indentSize` rather than `tabSize`, because `getFormattingOptions`
			// reports the model's indent size as the formatter's tab size.
			cells = [makeCell(CELL1_URI, 'python', CELL1_TEXT, 4, 6, { indentSize: 7 })];
			const seen: number[] = [];
			registerFormatter('python', 'formatter', (_model, options) => {
				seen.push(options.tabSize);
				return undefined;
			});

			await format();

			expect(seen).toEqual([7]);
		});

		it('consults the next provider for a cell when one rejects', async () => {
			const previous = errorHandler.getUnexpectedErrorHandler();
			errorHandler.setUnexpectedErrorHandler(() => { });
			try {
				cells = [makeCell(CELL2_URI, 'python', CELL2_TEXT, 10, 10)];
				registerFormatter('python', 'good', () => [edit(1, 1, 1, 8, 'ok')]);
				// Registered last, so asked first. A rejected promise is what
				// core's per-provider catch handles, so the walk continues.
				ctx.disposables.add(languageFeatures.documentFormattingEditProvider.register(
					{ language: 'python' },
					{
						provideDocumentFormattingEdits: () => {
							calls.push('rejects');
							return Promise.reject(new Error('provider failed'));
						},
					}));

				const result = await format();

				expect({
					edits: shapes(result.edits),
					called: calls.filter(call => call !== 'ensureSynchronized'),
				}).toEqual({ edits: ['(10,1)-(10,8) -> "ok"'], called: ['rejects', 'good'] });
			} finally {
				errorHandler.setUnexpectedErrorHandler(previous);
			}
		});

		it('contains a provider that throws synchronously, costing only its own cell', async () => {
			const previous = errorHandler.getUnexpectedErrorHandler();
			errorHandler.setUnexpectedErrorHandler(() => { });
			try {
				registerFormatter('python', 'formatter', model => {
					if (model.uri.toString() === CELL1_URI.toString()) {
						throw new Error('provider failed');
					}
					return [edit(1, 1, 1, 8, 'y = 2')];
				});

				const result = await format();

				// Core calls each provider outside its own catch, so a synchronous
				// throw ends the walk for that cell rather than falling through to
				// the next provider. The other cell still formats, and a formatter
				// failing is not grounds for vetoing the document.
				expect({ edits: shapes(result.edits), vetoedCells: result.vetoedCells })
					.toEqual({ edits: ['(10,1)-(10,8) -> "y = 2"'], vetoedCells: 0 });
			} finally {
				errorHandler.setUnexpectedErrorHandler(previous);
			}
		});

		it('contributes nothing for a chunk that holds no code', async () => {
			// Consecutive fences give a span of no lines while the model still has
			// one, so an edit on cell line 1 would map onto the closing fence.
			cells = [makeCell(CELL2_URI, 'python', '', 5, 4)];
			registerFormatter('python', 'formatter', () => [edit(1, 1, 1, 1, 'x = 1')]);

			const result = await format();

			expect(result).toEqual({ edits: [], vetoedCells: 0 });
		});

		it('skips a cell whose model was disposed and formats the rest', async () => {
			const doomed = makeCell(CELL1_URI, 'python', CELL1_TEXT, 4, 6);
			doomed.textModel.dispose();
			cells = [doomed, makeCell(CELL2_URI, 'python', CELL2_TEXT, 10, 10)];
			registerFormatter('python', 'formatter', () => [edit(1, 1, 1, 8, 'y = 2')]);

			const result = await format();

			// Reading a disposed model throws, so getting here at all is the point.
			expect({ edits: shapes(result.edits), vetoedCells: result.vetoedCells })
				.toEqual({ edits: ['(10,1)-(10,8) -> "y = 2"'], vetoedCells: 0 });
		});

		it('answers empty without vetoing when the request is cancelled', async () => {
			registerFormatter('python', 'formatter', () => [edit(1, 1, 1, 2, 'x')]);
			const source = new CancellationTokenSource();
			source.cancel();

			const result = await format(source.token);

			expect({ result, formattersCalled: calls.filter(c => c === 'formatter') })
				.toEqual({ result: { edits: [], vetoedCells: 0 }, formattersCalled: [] });
		});
	});

	describe('range formatting', () => {
		it('maps a range inside one cell in both directions', async () => {
			registerRangeFormatter('python', 'range-formatter', (_model, range) => {
				// Source line 6 is line 3 of the cell.
				expect(range).toMatchObject({ startLineNumber: 3, endLineNumber: 3 });
				return [edit(3, 1, 3, 8, 'x = 1')];
			});

			const result = await formatRange({
				startLineNumber: 6, startColumn: 1, endLineNumber: 6, endColumn: 8,
			});

			expect(shapes(result.edits)).toEqual(['(6,1)-(6,8) -> "x = 1"']);
		});

		it('declines a range that reaches the closing fence', async () => {
			registerRangeFormatter('python', 'range-formatter', () => [edit(1, 1, 1, 2, 'x')]);

			const result = await formatRange({
				startLineNumber: 6, startColumn: 1, endLineNumber: 7, endColumn: 1,
			});

			expect({ result, called: calls.filter(c => c === 'range-formatter') })
				.toEqual({ result: { edits: [], vetoedCells: 0 }, called: [] });
		});

		it('declines a range in the prose, where no cell exists', async () => {
			registerRangeFormatter('python', 'range-formatter', () => [edit(1, 1, 1, 2, 'x')]);

			const result = await formatRange({
				startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3,
			});

			expect({ result, called: calls.filter(c => c === 'range-formatter') })
				.toEqual({ result: { edits: [], vetoedCells: 0 }, called: [] });
		});
	});
});
