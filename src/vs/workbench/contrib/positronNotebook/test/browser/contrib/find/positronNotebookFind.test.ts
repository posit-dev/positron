/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// Register the find contribution
import '../../../../browser/contrib/find/positronNotebookFind.contribution.js';

import assert from 'assert';
import * as sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { IModelDecoration } from '../../../../../../../editor/common/model.js';
import { USUAL_WORD_SEPARATORS } from '../../../../../../../editor/common/core/wordHelper.js';
import { CONTEXT_FIND_WIDGET_VISIBLE, CONTEXT_FIND_INPUT_FOCUSED } from '../../../../../../../editor/contrib/find/browser/findModel.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { CellKind } from '../../../../../notebook/common/notebookCommon.js';
import { IPositronNotebookCell } from '../../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookFindController } from '../../../../browser/contrib/find/controller.js';
import { PositronFindInstance } from '../../../../browser/contrib/find/PositronFindInstance.js';
import { instantiateTestNotebookInstance, positronNotebookInstantiationService, TestPositronNotebookInstance } from '../../testPositronNotebookInstance.js';
import { transaction } from '../../../../../../../base/common/observable.js';
import { TestInstantiationService } from '../../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';

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

suite('PositronNotebookFindController', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;

	setup(() => {
		instantiationService = positronNotebookInstantiationService(disposables);
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

	});

	suite('Notebook Structure Changes', () => {
		let clock: sinon.SinonFakeTimers;

		setup(() => {
			clock = sinon.useFakeTimers();
		});

		teardown(() => {
			clock.restore();
		});

		test('adding a cell with matching content recomputes matches', () => {
			const { notebook, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 1);

			// Add a new cell with matching content
			notebook.addCell(CellKind.Code, 1, false, 'hello again');

			// Structural change triggers debounced recompute
			clock.tick(25);
			assert.strictEqual(find.matchCount.get(), 2);
		});

		test('deleting a cell with matches recomputes correctly', () => {
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

			clock.tick(25);
			assert.strictEqual(find.matchCount.get(), 1);
		});

		test('content edit that removes match recomputes correctly', () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 1);

			// Edit cell content to remove the match
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('goodbye world');

			clock.tick(25);
			assert.strictEqual(find.matchCount.get(), 0);
		});

		test('content edit that adds matches recomputes correctly', () => {
			const { notebook, find } = findFixture([['goodbye world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 0);

			// Edit cell to add matches
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('hello hello');

			clock.tick(25);
			assert.strictEqual(find.matchCount.get(), 2);
		});

		test('navigation remains correct after cell deletion', () => {
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

			clock.tick(25);
			assert.strictEqual(controller.matches.get().length, 2);

			// Navigation should work on new match set
			controller.findNext();
			assert.ok(controller.currentMatch.get());
		});

		test('decorations are cleaned up for deleted cells', () => {
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

			clock.tick(25);

			// Remaining cell still has decoration
			const cellsAfter = notebook.cells.get();
			assert.strictEqual(cellsAfter.length, 1);
			assert.strictEqual(getFindMatchDecorations(cellsAfter[0]).length, 1);
		});
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

		test('context key FIND_INPUT_FOCUSED toggles correctly', () => {
			const { notebook } = findFixture([['hello', 'python', CellKind.Code]]);

			// After show(), inputFocused is set to true
			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_INPUT_FOCUSED.key),
				true
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
		let clock: sinon.SinonFakeTimers;

		setup(() => {
			clock = sinon.useFakeTimers();
		});

		teardown(() => {
			clock.restore();
		});

		test('content change triggers debounced recompute', () => {
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
			clock.tick(25);
			assert.strictEqual(find.matchCount.get(), 3, 'Should have recomputed after debounce');
		});

		test('search param change triggers immediate recompute', () => {
			const { find } = findFixture([['hello Hello HELLO', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			assert.strictEqual(find.matchCount.get(), 3, 'Case-insensitive finds all');

			// Toggle matchCase — triggers immediate recompute via autorun (not debounced)
			find.matchCase.set(true, undefined);
			assert.strictEqual(find.matchCount.get(), 1, 'Case-sensitive finds only lowercase');
		});

		test('rapid content changes settle to correct final state', () => {
			const { notebook, find } = findFixture([['initial', 'python', CellKind.Code]]);
			find.searchString.set('final', undefined);
			assert.strictEqual(find.matchCount.get(), 0);

			// Rapid edits — each setValue() reschedules the debounce
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('first');
			cell.model.textModel!.setValue('second');
			cell.model.textModel!.setValue('final content');

			// Advance past the 20ms debounce — only final state matters
			clock.tick(25);
			assert.strictEqual(find.matchCount.get(), 1, 'Should find "final" in final content');
		});
	});

});
