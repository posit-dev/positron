/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// Register the find contribution
import '../../../../browser/contrib/find/positronNotebookFind.contribution.js';

import assert from 'assert';
import * as sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { IModelDecoration, ITextModel } from '../../../../../../../editor/common/model.js';
import { USUAL_WORD_SEPARATORS } from '../../../../../../../editor/common/core/wordHelper.js';
import { IBulkEditService, ResourceEdit, ResourceTextEdit } from '../../../../../../../editor/browser/services/bulkEditService.js';
import { EditOperation } from '../../../../../../../editor/common/core/editOperation.js';
import { Range } from '../../../../../../../editor/common/core/range.js';
import { CONTEXT_FIND_WIDGET_VISIBLE, CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_REPLACE_INPUT_FOCUSED } from '../../../../../../../editor/contrib/find/browser/findModel.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { CellKind } from '../../../../../notebook/common/notebookCommon.js';
import { IPositronNotebookCell } from '../../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookFindController } from '../../../../browser/contrib/find/controller.js';
import { PositronFindInstance } from '../../../../browser/contrib/find/PositronFindInstance.js';
import { instantiateTestNotebookInstance, positronNotebookInstantiationService, TestPositronNotebookInstance } from '../../testPositronNotebookInstance.js';
import { transaction } from '../../../../../../../base/common/observable.js';
import { TestInstantiationService } from '../../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { Disposable, IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../../../base/test/common/timeTravelScheduler.js';

/** Get the find controller for a notebook. */
function getController(notebook: TestPositronNotebookInstance): PositronNotebookFindController {
	const controller = PositronNotebookFindController.get(notebook);
	assert.ok(controller, 'Find controller should be registered');
	return controller;
}

/** Gets the find instance, starting the controller if needed. */
function getOrStartFindInstance(controller: PositronNotebookFindController): PositronFindInstance {
	let find = controller.findInstance;

	// Start if not already started
	if (!find) {
		controller.start();
		find = controller.findInstance;
	}

	assert.ok(find, 'Unexpected Error: Find instance should exist after controller.start()');
	return find;
}

function getDecorations(cell: IPositronNotebookCell): IModelDecoration[] {
	return cell.model.textModel?.getAllDecorations() ?? [];
}

function getFindMatchDecorations(cell: IPositronNotebookCell): IModelDecoration[] {
	return getDecorations(cell).filter(d => d.options.className === 'findMatch');
}

function getCurrentFindMatchDecoration(cell: IPositronNotebookCell): IModelDecoration | undefined {
	return getDecorations(cell).find(d => d.options.className === 'currentFindMatch');
}

function getCellSelection(cell: IPositronNotebookCell): [number, number, number, number] | null {
	const selection = cell.currentEditor?.getSelection();
	if (!selection) {
		return null;
	}
	return [selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn];
}

/** Waits past the 20ms debounce used by the notebook content change scheduler. */
function waitForDebounce(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 25));
}

/**
 * Lightweight IBulkEditService for tests, modeled after the unexported
 * StandaloneBulkEditService in standaloneServices.ts.
 * Groups edits by model and applies them atomically via pushEditOperations
 * (which supports undo, unlike model.applyEdits).
 */
class TestBulkEditService implements IBulkEditService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly _modelService: IModelService) { }

	hasPreviewHandler(): false { return false; }
	setPreviewHandler(): IDisposable { return Disposable.None; }

	async apply(editsIn: ResourceEdit[]): Promise<{ ariaSummary: string; isApplied: boolean }> {
		const textEdits = new Map<string, { model: ITextModel; ops: ReturnType<typeof EditOperation.replaceMove>[] }>();

		for (const edit of editsIn) {
			if (!(edit instanceof ResourceTextEdit)) {
				throw new Error('TestBulkEditService only supports ResourceTextEdit');
			}
			const model = this._modelService.getModel(edit.resource);
			if (!model) {
				throw new Error(`Model not found for ${edit.resource}`);
			}
			const key = edit.resource.toString();
			let entry = textEdits.get(key);
			if (!entry) {
				entry = { model, ops: [] };
				textEdits.set(key, entry);
			}
			entry.ops.push(EditOperation.replaceMove(Range.lift(edit.textEdit.range), edit.textEdit.text));
		}

		let totalEdits = 0;
		for (const { model, ops } of textEdits.values()) {
			model.pushStackElement();
			model.pushEditOperations([], ops, () => []);
			model.pushStackElement();
			totalEdits += ops.length;
		}

		return { ariaSummary: '', isApplied: totalEdits > 0 };
	}
}

suite('PositronNotebookFindController', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let bulkEditApplySpy: sinon.SinonSpy;

	setup(() => {
		instantiationService = positronNotebookInstantiationService(disposables);

		const bulkEditService = new TestBulkEditService(instantiationService.get(IModelService));
		bulkEditApplySpy = sinon.spy(bulkEditService, 'apply');
		instantiationService.stub(IBulkEditService, bulkEditService);
	});

	function createNotebook(cells: [string, string, CellKind][]) {
		return instantiateTestNotebookInstance(cells, instantiationService, disposables);
	}

	function findFixture(cells: [string, string, CellKind][]) {
		const notebook = createNotebook(cells);
		const controller = getController(notebook);
		const find = getOrStartFindInstance(controller);
		return { notebook, controller, find };
	}

	suite('Matching Logic', () => {

		test('finds single match in one code cell', () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);

			assert.strictEqual(controller.matches.get().length, 1);
			assert.strictEqual(find.matchCount.get(), 1);
			assert.strictEqual(find.matchIndex.get(), 0);
		});

		test('finds multiple matches in one code cell', () => {
			const { controller, find } = findFixture([['hello hello hello', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);

			assert.strictEqual(controller.matches.get().length, 3);
			assert.strictEqual(find.matchCount.get(), 3);
			assert.strictEqual(find.matchIndex.get(), 0);
		});

		test('finds matches in markdown cells', () => {
			const { controller, find } = findFixture([['# Hello World', 'markdown', CellKind.Markup]]);

			find.searchString.set('Hello', undefined);

			assert.strictEqual(controller.matches.get().length, 1);
		});

		test('finds matches across multiple cells in index order', () => {
			const { controller, find } = findFixture([
				['alpha beta', 'python', CellKind.Code],
				['gamma', 'python', CellKind.Code],
				['alpha delta', 'python', CellKind.Code],
			]);

			find.searchString.set('alpha', undefined);

			const matches = controller.matches.get();
			assert.strictEqual(matches.length, 2);
			assert.strictEqual(matches[0].cellRange.cellIndex, 0);
			assert.strictEqual(matches[1].cellRange.cellIndex, 2);
		});

		test('matchCase=false is case-insensitive', () => {
			const { controller, find } = findFixture([['Hello HELLO hello', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);

			assert.strictEqual(controller.matches.get().length, 3);
		});

		test('matchCase=true is case-sensitive', () => {
			const { controller, find } = findFixture([['Hello HELLO hello', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.matchCase.set(true, tx);
				find.searchString.set('hello', tx);
			});

			assert.strictEqual(controller.matches.get().length, 1);
		});

		test('isRegex=true supports regex patterns', () => {
			const { controller, find } = findFixture([['foo123 bar456 baz', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('\\w+\\d+', tx);
			});

			assert.strictEqual(controller.matches.get().length, 2);
		});

		test('isRegex=true with invalid regex fails safely', () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('[invalid', tx);
			});

			assert.strictEqual(controller.matches.get().length, 0);
			assert.strictEqual(find.matchCount.get(), 0);
			assert.strictEqual(find.matchIndex.get(), undefined);
		});

		test('isRegex=false treats regex symbols literally', () => {
			const { controller, find } = findFixture([['a.b a*b a+b', 'python', CellKind.Code]]);

			find.searchString.set('a.b', undefined);

			assert.strictEqual(controller.matches.get().length, 1, 'Should match literal "a.b" only');
		});

		test('wholeWord=true only matches full words', async () => {
			const { notebook, controller, find } = findFixture([['cat catch category', 'python', CellKind.Code]]);
			const configService = notebook.instantiationService.get(IConfigurationService) as TestConfigurationService;
			await configService.setUserConfiguration('editor.wordSeparators', USUAL_WORD_SEPARATORS);

			transaction((tx) => {
				find.wholeWord.set(true, tx);
				find.searchString.set('cat', tx);
			});

			assert.strictEqual(controller.matches.get().length, 1, 'Should match only standalone "cat"');
		});

		test('wholeWord=false allows partial-word matches', () => {
			const { controller, find } = findFixture([['cat catch category', 'python', CellKind.Code]]);

			find.searchString.set('cat', undefined);

			assert.strictEqual(controller.matches.get().length, 3, 'Should match "cat" in all words');
		});

		test('empty search string returns zero matches', () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);

			find.searchString.set('', undefined);

			assert.strictEqual(controller.matches.get().length, 0);
			assert.strictEqual(find.matchIndex.get(), undefined);
		});

		test('no-cell notebook returns zero matches', () => {
			const { controller, find } = findFixture([]);

			find.searchString.set('hello', undefined);

			assert.strictEqual(controller.matches.get().length, 0);
		});

		test('match ordering is stable: within-cell positions preserved', () => {
			const { controller, find } = findFixture([['bb aa cc aa', 'python', CellKind.Code]]);

			find.searchString.set('aa', undefined);

			const matches = controller.matches.get();
			assert.strictEqual(matches.length, 2);
			// First "aa" at column 4, second "aa" at column 10
			assert.ok(
				matches[0].cellRange.isBefore(matches[1].cellRange),
				'Matches within a cell should be in column order'
			);
		});

		test('reactive: query change triggers research', () => {
			const { find } = findFixture([['hello world', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 1);

			// Change query reactively — autorun fires synchronously
			find.searchString.set('good bye', undefined);
			assert.strictEqual(find.matchCount.get(), 0);
		});

		test('reactive: toggle change triggers research', () => {
			const { find } = findFixture([['Hello hello', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 2, 'case-insensitive should find 2');

			// Toggle matchCase reactively — autorun fires synchronously
			find.matchCase.set(true, undefined);
			assert.strictEqual(find.matchCount.get(), 1, 'case-sensitive should find 1');
		});
	});

	suite('Navigation', () => {

		test('findNext advances within same cell', () => {
			const { controller, find } = findFixture([['aa bb aa bb aa', 'python', CellKind.Code]]);
			find.searchString.set('aa', undefined);

			controller.findNext();
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 0);

			controller.findNext();
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 1);

			controller.findNext();
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 2);
		});

		test('findPrevious moves backward within same cell', () => {
			const { controller, find } = findFixture([['aa bb aa bb aa', 'python', CellKind.Code]]);
			find.searchString.set('aa', undefined);

			// Navigate forward to establish current match
			controller.findNext(); // match 0
			controller.findNext(); // match 1

			controller.findPrevious(); // back to match 0
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 0);
		});

		test('findNext wraps from last to first match', () => {
			const { controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			controller.findNext(); // match 0
			controller.findNext(); // match 1
			controller.findNext(); // wraps to match 0
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 0);
		});

		test('findPrevious wraps from first to last match', () => {
			const { controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			controller.findNext(); // match 0
			controller.findPrevious(); // wraps to match 1 (last)
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 1);
		});

		test('cross-cell navigation moves to correct target match', () => {
			const { controller, find } = findFixture([
				['alpha', 'python', CellKind.Code],
				['no match', 'python', CellKind.Code],
				['alpha', 'python', CellKind.Code],
			]);
			find.searchString.set('alpha', undefined);

			controller.findNext(); // match 0 (cell 0)
			assert.strictEqual(controller.currentMatch.get()?.cellMatch.cellRange.cellIndex, 0);

			controller.findNext(); // match 1 (cell 2)
			assert.strictEqual(controller.currentMatch.get()?.cellMatch.cellRange.cellIndex, 2);
		});

		test('navigation sets editor selection', () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('world', undefined);

			controller.findNext();
			const cells = notebook.cells.get();
			const selection = getCellSelection(cells[0]);
			// "world" starts at column 7 and ends at column 12
			assert.deepStrictEqual(selection, [1, 7, 1, 12]);
		});

		test('no matches: findNext is no-op', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('xyz', undefined);

			controller.findNext();
			assert.strictEqual(controller.currentMatch.get(), undefined);
		});

		test('no matches: findPrevious is no-op', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('xyz', undefined);

			controller.findPrevious();
			assert.strictEqual(controller.currentMatch.get(), undefined);
		});

		test('findNext from cursor position when no current match', () => {
			const { notebook, controller, find } = findFixture([['aa bb aa cc aa', 'python', CellKind.Code]]);

			// Place cursor after the first "aa" (at column 3)
			const cell = notebook.cells.get()[0];
			cell.currentEditor!.setPosition({ lineNumber: 1, column: 4 });

			find.searchString.set('aa', undefined);

			// findNext should find the next match after cursor position
			controller.findNext();
			const match = controller.currentMatch.get();
			assert.ok(match);
			// The match at column 7 (second "aa") should be found
			assert.strictEqual(match.cellMatch.cellRange.range.startColumn, 7);
		});

		// Regression: findNext() was a no-op when the cursor was past all
		// matches because findNextMatchFromCursor() returned -1 instead of
		// wrapping to the first match.
		test('findNext wraps to first match when cursor is past all matches', () => {
			const { notebook, controller, find } = findFixture([['aa bb', 'python', CellKind.Code]]);

			// Place cursor at column 4 ('aa |bb') — past the only 'aa' match
			const cell = notebook.cells.get()[0];
			cell.currentEditor!.setPosition({ lineNumber: 1, column: 4 });

			find.searchString.set('aa', undefined);

			assert.strictEqual(find.matchCount.get(), 1);
			assert.strictEqual(find.matchIndex.get(), 0);
			assert.strictEqual(controller.currentMatch.get(), undefined,
				'research sets matchIndex but not currentMatch');

			controller.findNext();
			const match = controller.currentMatch.get();
			assert.ok(match, 'findNext should wrap to the first match');
			assert.strictEqual(match.matchIndex, 0);
			assert.strictEqual(match.cellMatch.cellRange.range.startColumn, 1);
		});

	});

	suite('Notebook Structure Changes', () => {

		test('adding a cell with matching content recomputes matches', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 1);

			// Add a new cell with matching content
			notebook.addCell(CellKind.Code, 1, false, 'hello again');

			// Structural change triggers debounced recompute
			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 2);
		}));

		test('deleting a cell with matches recomputes correctly', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([
				['hello', 'python', CellKind.Code],
				['hello', 'python', CellKind.Code],
				['world', 'python', CellKind.Code],
			]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 2);

			// Delete second cell (which has a match)
			const cells = notebook.cells.get();
			notebook.deleteCell(cells[1]);

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 1);
		}));

		test('content edit that removes match recomputes correctly', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 1);

			// Edit cell content to remove the match
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('goodbye world');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 0);
		}));

		test('content edit that adds matches recomputes correctly', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['goodbye world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 0);

			// Edit cell to add matches
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('hello hello');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 2);
		}));

		test('navigation remains correct after cell deletion', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
			]);
			find.searchString.set('match', undefined);
			assert.strictEqual(find.matchCount.get(), 3);

			// Navigate to first match
			controller.findNext();
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 0);

			// Delete first cell
			const cells = notebook.cells.get();
			notebook.deleteCell(cells[0]);

			await waitForDebounce();
			assert.strictEqual(controller.matches.get().length, 2);

			// Navigation should work on new match set
			controller.findNext();
			assert.ok(controller.currentMatch.get());
		}));

		test('decorations are cleaned up for deleted cells', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
			]);
			find.searchString.set('match', undefined);

			const cellsBefore = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cellsBefore[0]).length, 1);
			assert.strictEqual(getFindMatchDecorations(cellsBefore[1]).length, 1);

			// Delete first cell
			notebook.deleteCell(cellsBefore[0]);

			await waitForDebounce();

			// Remaining cell still has decoration
			const cellsAfter = notebook.cells.get();
			assert.strictEqual(cellsAfter.length, 1);
			assert.strictEqual(getFindMatchDecorations(cellsAfter[0]).length, 1);
		}));
	});

	suite('Decorations', () => {

		test('decorations applied for all matches', () => {
			const { notebook, find } = findFixture([
				['aa bb aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 2);
			assert.strictEqual(getFindMatchDecorations(cells[1]).length, 1);
		});

		test('current match decoration is distinct and updates on navigation', () => {
			const { notebook, controller, find } = findFixture([['aa bb aa', 'python', CellKind.Code]]);
			find.searchString.set('aa', undefined);

			const cells = notebook.cells.get();

			// Before navigation, no current match decoration
			assert.strictEqual(getCurrentFindMatchDecoration(cells[0]), undefined);

			controller.findNext(); // match 0
			const currentDec = getCurrentFindMatchDecoration(cells[0]);
			assert.ok(currentDec, 'Should have current match decoration');
			assert.strictEqual(currentDec!.range.startColumn, 1);

			controller.findNext(); // match 1
			const nextDec = getCurrentFindMatchDecoration(cells[0]);
			assert.ok(nextDec, 'Should still have current match decoration');
			assert.strictEqual(nextDec!.range.startColumn, 7, 'Decoration should move to second "aa"');
		});

		test('current match decoration moves across cells', () => {
			const { notebook, controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			const cells = notebook.cells.get();

			controller.findNext(); // match 0 (cell 0)
			assert.ok(getCurrentFindMatchDecoration(cells[0]));
			assert.strictEqual(getCurrentFindMatchDecoration(cells[1]), undefined);

			controller.findNext(); // match 1 (cell 1)
			assert.strictEqual(getCurrentFindMatchDecoration(cells[0]), undefined, 'Cell 0 should lose current decoration');
			assert.ok(getCurrentFindMatchDecoration(cells[1]), 'Cell 1 should gain current decoration');
		});

		test('decorations update when query changes', () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);
			assert.strictEqual(getFindMatchDecorations(cells[0])[0].range.startColumn, 1);

			// Change search to match 'world' — autorun fires synchronously
			find.searchString.set('world', undefined);
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);
			assert.strictEqual(getFindMatchDecorations(cells[0])[0].range.startColumn, 7);
		});

		test('decorations clear when query is emptied', () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);

			// Empty the search — autorun fires synchronously
			find.searchString.set('', undefined);
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 0);
		});

		test('decorations clear when find is hidden', () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);

			// Hide find widget — autorun clears matches synchronously
			controller.hide();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 0, 'Decorations should clear on hide');
		});

		test('decoration count matches found matches', () => {
			const { notebook, controller, find } = findFixture([
				['aaa', 'python', CellKind.Code],
			]);

			find.searchString.set('a', undefined);

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, controller.matches.get().length);
		});
	});

	suite('Focus and Visibility', () => {

		test('starting find makes widget visible', () => {
			const { find } = findFixture([['hello', 'python', CellKind.Code]]);
			assert.strictEqual(find.isVisible.get(), true);
		});

		test('hiding find makes widget not visible', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			assert.strictEqual(find.isVisible.get(), true);

			controller.hide();
			assert.strictEqual(find.isVisible.get(), false);
		});

		test('starting find twice reuses same instance', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);

			const fi1 = controller.findInstance;
			controller.start();
			const fi2 = controller.findInstance;
			assert.strictEqual(fi1, fi2, 'Should reuse same find instance');
			assert.strictEqual(fi1, find);
		});

		test('hiding find clears matches and current match', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 1);

			controller.hide();
			assert.strictEqual(controller.matches.get().length, 0);
			assert.strictEqual(controller.currentMatch.get(), undefined);
		});

		test('context key FIND_WIDGET_VISIBLE toggles correctly', () => {
			const { notebook, controller } = findFixture([['hello', 'python', CellKind.Code]]);

			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_WIDGET_VISIBLE.key),
				true
			);

			controller.hide();
			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_WIDGET_VISIBLE.key),
				false
			);
		});

		test('context key FIND_INPUT_FOCUSED is true immediately after show', () => {
			// Must be set synchronously so that cells don't consume keyboard
			// events (e.g. Enter to edit the active cell) before the find
			// widget's keybindings take effect.
			const { notebook } = findFixture([['hello', 'python', CellKind.Code]]);

			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_INPUT_FOCUSED.key),
				true
			);
		});

		test('context key FIND_INPUT_FOCUSED is false after hide', () => {
			const { notebook, controller } = findFixture([['hello', 'python', CellKind.Code]]);

			// Verify hide resets the context key.
			controller.hide();
			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_INPUT_FOCUSED.key),
				false
			);
		});

		test('context key REPLACE_INPUT_FOCUSED is false after show and false after hide', () => {
			const { notebook, controller } = findFixture([['hello', 'python', CellKind.Code]]);

			// After show(), replace input is not focused
			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_REPLACE_INPUT_FOCUSED.key),
				false
			);

			// Hide keeps it false
			controller.hide();
			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_REPLACE_INPUT_FOCUSED.key),
				false
			);
		});

		test('detaching view hides find widget', () => {
			const { notebook, find } = findFixture([['hello', 'python', CellKind.Code]]);
			assert.strictEqual(find.isVisible.get(), true);

			// Detach view
			notebook.detachView();
			assert.strictEqual(find.isVisible.get(), false);
		});

		test('hide before start is no-op', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			// Should not throw
			controller.hide();
			assert.strictEqual(controller.findInstance, undefined);
		});
	});

	suite('State Isolation', () => {

		test('two notebooks maintain independent match state', () => {
			const notebook1 = createNotebook([['hello', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['world', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('hello', undefined);
			assert.strictEqual(find1.matchCount.get(), 1);
			assert.strictEqual(controller2.findInstance, undefined, 'nb2 controller should have no find instance yet');

			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('world', undefined);
			assert.strictEqual(find2.matchCount.get(), 1);
			assert.strictEqual(find1.matchCount.get(), 1, 'nb1 match count unchanged');
		});

		test('matches reference cells from their own notebook', () => {
			const notebook1 = createNotebook([['shared term', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['shared term', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('shared', undefined);
			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('shared', undefined);

			assert.strictEqual(controller1.matches.get()[0].cell, notebook1.cells.get()[0]);
			assert.strictEqual(controller2.matches.get()[0].cell, notebook2.cells.get()[0]);
			assert.notStrictEqual(controller1.matches.get()[0].cell, controller2.matches.get()[0].cell);
		});

		test('decorations are independent across notebooks', () => {
			const notebook1 = createNotebook([['aaa', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['bbb', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('aaa', undefined);
			assert.ok(getFindMatchDecorations(notebook1.cells.get()[0]).length > 0, 'nb1 should have decorations');
			assert.strictEqual(getFindMatchDecorations(notebook2.cells.get()[0]).length, 0, 'nb2 should have no decorations');

			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('bbb', undefined);
			assert.ok(getFindMatchDecorations(notebook2.cells.get()[0]).length > 0, 'nb2 should now have decorations');
			assert.ok(getFindMatchDecorations(notebook1.cells.get()[0]).length > 0, 'nb1 decorations should be unchanged');
		});

		test('hiding find in one notebook does not affect the other', () => {
			const notebook1 = createNotebook([['foo', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['foo', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('foo', undefined);
			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('foo', undefined);

			controller1.hide();
			assert.strictEqual(controller1.matches.get().length, 0, 'nb1 matches should be cleared');
			assert.strictEqual(find2.matchCount.get(), 1, 'nb2 matches should be unaffected');
		});
	});

	suite('Debounce and Reactive Updates', () => {

		test('content change triggers debounced recompute', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			// Set up search — autorun fires synchronously when observables change
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 1);

			// setValue() propagates through the event chain:
			// TextModel → NotebookCellTextModel → NotebookTextModel → controller debounce
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('hello hello hello');

			// Matches haven't updated yet — debounce hasn't fired
			assert.strictEqual(find.matchCount.get(), 1, 'Should not recompute before debounce fires');

			// Advance past the 20ms debounce
			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 3, 'Should have recomputed after debounce');
		}));

		test('search param change triggers immediate recompute', () => {
			const { find } = findFixture([['hello Hello HELLO', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 3, 'Case-insensitive finds all');

			// Toggle matchCase — triggers immediate recompute via autorun (not debounced)
			find.matchCase.set(true, undefined);
			assert.strictEqual(find.matchCount.get(), 1, 'Case-sensitive finds only lowercase');
		});

		test('rapid content changes settle to correct final state', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['initial', 'python', CellKind.Code]]);
			find.searchString.set('final', undefined);
			assert.strictEqual(find.matchCount.get(), 0);

			// Rapid edits — each setValue() reschedules the debounce
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('first');
			cell.model.textModel!.setValue('second');
			cell.model.textModel!.setValue('final content');

			// Advance past the 20ms debounce — only final state matters
			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 1, 'Should find "final" in final content');
		}));
	});

	suite('Replace Single Match', () => {

		test('replace() with no current match navigates to first match without replacing', async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});
			assert.strictEqual(find.matchCount.get(), 2);

			// No current match yet — replace should just navigate
			await controller.replace();

			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 0);
			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'hello world hello', 'Text should be unchanged');
		});

		test('replace() with current match replaces it and advances to next', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});

			// Navigate to first match
			controller.findNext();
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 0);

			// Replace
			await controller.replace();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'goodbye world hello');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 1);
		}));

		test('replace() with current match on last match wraps to first', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});

			// Navigate to last match (index 1)
			controller.findNext();
			controller.findNext();
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 1);

			// Replace last match
			await controller.replace();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'hello world goodbye');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 1);
			// Should wrap to match 0 (the remaining 'hello')
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 0);
		}));

		test('replace() does nothing when there are no matches', async () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('xyz', tx);
				find.replaceText.set('replaced', tx);
			});
			assert.strictEqual(find.matchCount.get(), 0);

			await controller.replace();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'hello world');
			assert.strictEqual(controller.currentMatch.get(), undefined);
			assert.ok(bulkEditApplySpy.notCalled, 'IBulkEditService.apply should not be called');
		});

		test('replace() uses literal text when regex is off', async () => {
			const { notebook, controller, find } = findFixture([['foo123 bar', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('foo123', tx);
				find.replaceText.set('$1-replaced', tx);
			});

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			// '$1' should be treated literally, not as a capture group
			assert.strictEqual(cell.model.textModel!.getValue(), '$1-replaced bar');
		});

		test('replace() uses capture groups when regex is on', async () => {
			const { notebook, controller, find } = findFixture([['foo123 bar456', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('(\\w+?)(\\d+)', tx);
				find.replaceText.set('$2-$1', tx);
			});

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), '123-foo bar456');
		});

		test('replace() with preserveCase inherits casing from matched text', async () => {
			const { notebook, controller, find } = findFixture([['Hello world', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.preserveCase.set(true, tx);
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			// 'Hello' matched -> 'goodbye' should become 'Goodbye'
			assert.strictEqual(cell.model.textModel!.getValue(), 'Goodbye world');
		});

		test('replace() calls IBulkEditService.apply with correct ResourceTextEdit', async () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('hi', tx);
			});

			controller.findNext();
			await controller.replace();

			assert.ok(bulkEditApplySpy.calledOnce, 'apply should be called once');
			const edits = bulkEditApplySpy.firstCall.args[0];
			assert.strictEqual(edits.length, 1);
			assert.strictEqual(edits[0].textEdit.text, 'hi');
			// 'hello' is at [1,1 -> 1,6]
			assert.strictEqual(edits[0].textEdit.range.startLineNumber, 1);
			assert.strictEqual(edits[0].textEdit.range.startColumn, 1);
			assert.strictEqual(edits[0].textEdit.range.endLineNumber, 1);
			assert.strictEqual(edits[0].textEdit.range.endColumn, 6);
			// Check options label
			const options = bulkEditApplySpy.firstCall.args[1];
			assert.strictEqual(options.quotableLabel, 'Notebook Replace');
		});

		test('replace() triggers research via content change debounce', () => runWithFakedTimers({}, async () => {
			const { controller, find } = findFixture([['hello hello hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});
			assert.strictEqual(find.matchCount.get(), 3);

			controller.findNext();
			await controller.replace();

			// After debounce, match count should update
			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 2);
		}));

		// Matches upstream text-editor behavior (findModel.ts): the first
		// replace() call after a fresh search navigates to the match; the
		// second call performs the actual replacement.
		test('replace() after fresh search navigates first, then replaces on second call', async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});
			assert.strictEqual(find.matchCount.get(), 2);
			assert.strictEqual(controller.currentMatch.get(), undefined, 'currentMatch should be unset after a fresh search');

			// First replace() navigates to the first match without replacing.
			await controller.replace();
			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'hello world hello',
				'First replace() should navigate, not replace');
			assert.ok(controller.currentMatch.get() !== undefined,
				'currentMatch should be set after first replace()');

			// Second replace() performs the replacement.
			await controller.replace();
			assert.strictEqual(cell.model.textModel!.getValue(), 'goodbye world hello',
				'Second replace() should replace the first match');
		});
	});

	suite('Replace All', () => {

		test('replaceAll() replaces all matches in one operation', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'bye world bye');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 0);
		}));

		test('replaceAll() works across multiple cells', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([
				['hello', 'python', CellKind.Code],
				['world', 'python', CellKind.Code],
				['hello again', 'python', CellKind.Code],
			]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});

			await controller.replaceAll();

			const cells = notebook.cells.get();
			assert.strictEqual(cells[0].model.textModel!.getValue(), 'bye');
			assert.strictEqual(cells[1].model.textModel!.getValue(), 'world');
			assert.strictEqual(cells[2].model.textModel!.getValue(), 'bye again');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 0);
		}));

		test('replaceAll() applies all edits in a single IBulkEditService.apply call', async () => {
			const { controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			transaction((tx) => {
				find.searchString.set('aa', tx);
				find.replaceText.set('bb', tx);
			});

			await controller.replaceAll();

			assert.ok(bulkEditApplySpy.calledOnce, 'apply should be called exactly once');
			const edits = bulkEditApplySpy.firstCall.args[0];
			assert.strictEqual(edits.length, 2, 'Should have two ResourceTextEdit objects');
			const options = bulkEditApplySpy.firstCall.args[1];
			assert.strictEqual(options.quotableLabel, 'Notebook Replace All');
		});

		test('replaceAll() with zero matches is a no-op', async () => {
			const { notebook, controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('xyz', tx);
				find.replaceText.set('replaced', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'hello');
			assert.ok(bulkEditApplySpy.notCalled, 'IBulkEditService.apply should not be called');
		});

		test('replaceAll() with regex capture groups builds per-match replacements', async () => {
			const { notebook, controller, find } = findFixture([['foo123 bar456', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('(\\w+?)(\\d+)', tx);
				find.replaceText.set('$2-$1', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), '123-foo 456-bar');
		});

		// Undo grouping is verified by the "single IBulkEditService.apply call"
		// test above. The real BulkEditService uses pushEditOperations which
		// supports undo, so direct undo verification could be added if needed.
	});

	suite('Replace Edge Cases', () => {

		test('replace when match text equals replacement text still advances', async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('hello', tx);
			});

			controller.findNext(); // match 0
			await controller.replace();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'hello world hello');
			assert.ok(bulkEditApplySpy.calledOnce, 'apply should still be called');

			// No debounce needed: replace() calls findNext() which sets
			// currentMatch synchronously. The text didn't change so
			// research() is a no-op.
			assert.strictEqual(controller.currentMatch.get()?.matchIndex, 1);
		});

		test('replace with empty string deletes matched text', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello ', tx);
				find.replaceText.set('', tx);
			});

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'world');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 0);
		}));

		test('replaceAll with empty string deletes all matched text', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), ' world ');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 0);
		}));

		test('replace triggers research and updates decorations', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});
			assert.strictEqual(find.matchCount.get(), 2);

			controller.findNext();
			await controller.replace();

			await waitForDebounce();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(getFindMatchDecorations(cell).length, 1, 'One remaining match decoration');
		}));

		test('replaceAll clears all decorations', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});

			await controller.replaceAll();

			await waitForDebounce();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(getFindMatchDecorations(cell).length, 0);
			assert.strictEqual(getCurrentFindMatchDecoration(cell), undefined);
		}));

		test('replace on multi-line content', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['line1\nline2\nline1', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('line1', tx);
				find.replaceText.set('replaced', tx);
			});
			assert.strictEqual(find.matchCount.get(), 2);

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			assert.strictEqual(cell.model.textModel!.getValue(), 'replaced\nline2\nline1');

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 1);
		}));

		// Regression test for: replace() does nothing when cursor is past all matches.
		//
		// Repro steps:
		// 1. Create a single cell with content 'aa bb'.
		// 2. In edit mode, place cursor between the space and 'bb' (column 4): 'aa |bb'.
		// 3. Open the find widget and type 'aa' in the search field.
		// 4. Type 'test' in the replace field.
		// 5. Click the Replace button.
		//
		// Expected: First click navigates to the 'aa' match, second click replaces it.
		// Actual (bug): Nothing happens on any number of clicks because
		// findNextMatchFromCursor() returns -1 when the cursor is past all matches
		// (no wrap-around).
		test('replace() works when cursor is positioned after all matches in the cell', async () => {
			const { notebook, controller, find } = findFixture([['aa bb', 'python', CellKind.Code]]);
			const cell = notebook.cells.get()[0];

			// Place cursor at column 4 ('aa |bb') — past the only 'aa' match at [1,1]-[1,3]
			cell.currentEditor!.setPosition({ lineNumber: 1, column: 4 });

			transaction((tx) => {
				find.searchString.set('aa', tx);
				find.replaceText.set('test', tx);
			});
			assert.strictEqual(find.matchCount.get(), 1);

			// First replace() should navigate to the match (two-step behavior)
			await controller.replace();
			assert.strictEqual(cell.model.textModel!.getValue(), 'aa bb',
				'First replace() should navigate, not replace');
			assert.ok(controller.currentMatch.get() !== undefined,
				'currentMatch should be set after first replace()');

			// Second replace() should perform the actual replacement
			await controller.replace();
			assert.strictEqual(cell.model.textModel!.getValue(), 'test bb',
				'Second replace() should replace the match');
		});

		// Regression test for: after replace() changes text and research
		// recomputes matches, the next replace() call requires an extra click
		// to navigate before it will replace.
		//
		// Repro steps:
		// 1. Create a cell with 'hello world hello'.
		// 2. Open find/replace, search 'hello', replace 'hi'.
		// 3. Click Replace to navigate to match 0 (expected two-step behavior).
		// 4. Click Replace to replace match 0 -> 'hi world hello'.
		// 5. Wait for debounced research to recompute matches.
		// 6. Click Replace again.
		//
		// Expected: Step 6 immediately replaces the remaining 'hello' -> 'hi world hi'.
		// Actual (bug): Step 6 only navigates to the match; a seventh click is
		// needed to actually replace it. This happens because replace() advances
		// currentMatch synchronously, but the debounced research clears it
		// (the replacement shifted match positions), causing the next replace()
		// to treat it as a fresh search (navigate-first).
		//
		// Uses different-length replacement ('hello' -> 'hi') so that the second
		// match's position shifts, making the stale currentMatch invalid.
		test('replace() after debounce-triggered research immediately replaces next match', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			const cell = notebook.cells.get()[0];

			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('hi', tx);
			});
			assert.strictEqual(find.matchCount.get(), 2);

			// Navigate to match 0 (two-step behavior for fresh search)
			await controller.replace();
			assert.strictEqual(cell.model.textModel!.getValue(), 'hello world hello',
				'First replace() should navigate, not replace');

			// Replace match 0
			await controller.replace();
			assert.strictEqual(cell.model.textModel!.getValue(), 'hi world hello',
				'Second replace() should replace match 0');

			// Wait for debounced research to recompute matches.
			// The remaining 'hello' shifted from column 13 to column 10
			// due to the shorter replacement, so the old currentMatch is stale.
			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 1);

			// This replace() should immediately replace the remaining match
			// without requiring an extra navigation click
			await controller.replace();
			assert.strictEqual(cell.model.textModel!.getValue(), 'hi world hi',
				'replace() after research should immediately replace, not just navigate');
		}));
	});

	suite('Performance Optimizations', () => {

		test('research() does not store capture groups (only needed for replace)', () => {
			const { controller, find } = findFixture([['foo123 bar456', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('(\\w+?)(\\d+)', tx);
			});

			const matches = controller.matches.get();
			assert.strictEqual(matches.length, 2);
			// research() should not pay the cost of capturing groups
			assert.strictEqual(matches[0].matches, null);
			assert.strictEqual(matches[1].matches, null);
		});

		test('replaceAll() replaces all matches beyond the decoration limit', () => runWithFakedTimers({}, async () => {
			// 1100 occurrences of 'aa', exceeding the default findMatches
			// limitResultCount of 1000. research() should cap at 1000 for
			// decorations, but replaceAll() must replace all 1100.
			const content = Array(1100).fill('aa').join(' ');
			const { notebook, controller, find } = findFixture([[content, 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('aa', tx);
				find.replaceText.set('bb', tx);
			});

			// research() should cap matches for decorations.
			// The default findMatches limitResultCount is 999.
			const cell = notebook.cells.get()[0];
			assert.strictEqual(controller.matches.get().length, 999,
				'research() should limit matches to 999 for decorations');
			assert.strictEqual(getFindMatchDecorations(cell).length, 999,
				'decorations should be capped at 999');

			// replaceAll() should replace ALL 1100, not just the decorated 1000
			await controller.replaceAll();

			assert.ok(
				!cell.model.textModel!.getValue().includes('aa'),
				'All 1100 matches should be replaced, not just the first 1000'
			);

			await waitForDebounce();
			assert.strictEqual(find.matchCount.get(), 0);
		}));
	});

});
