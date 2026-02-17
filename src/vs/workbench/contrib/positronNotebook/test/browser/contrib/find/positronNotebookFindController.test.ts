/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// Register the find contribution
import '../../../../browser/contrib/find/positronNotebookFind.contribution.js';

import assert from 'assert';
import { timeout } from '../../../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { CellKind } from '../../../../../notebook/common/notebookCommon.js';
import { CurrentPositronCellMatch, PositronCellFindMatch, PositronNotebookFindController } from '../../../../browser/contrib/find/controller.js';
import { PositronFindInstance } from '../../../../browser/contrib/find/PositronFindInstance.js';
import { CONTEXT_FIND_WIDGET_VISIBLE, CONTEXT_FIND_INPUT_FOCUSED } from '../../../../../../../editor/contrib/find/browser/findModel.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { USUAL_WORD_SEPARATORS } from '../../../../../../../editor/common/core/wordHelper.js';
import {
	createTestPositronNotebookEditor,
	getCellSelection,
	getCurrentFindMatchDecoration,
	getFindMatchDecorations,
	TestPositronNotebookInstance,
} from '../../testPositronNotebookInstance.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Access private controller internals for testing.
 * Concentrated here to minimize as-any casts throughout tests.
 */
function internals(controller: PositronNotebookFindController): any {
	return controller;
}

/** Gets the find instance, asserting it exists. */
function getFindInstance(controller: PositronNotebookFindController): PositronFindInstance {
	const fi = controller.findInstance;
	assert.ok(fi, 'Find instance should exist (call controller.start() first)');
	return fi;
}

/**
 * Direct API: start find and perform a synchronous search.
 * Returns the matches array.
 */
function search(
	controller: PositronNotebookFindController,
	query: string,
	opts?: { isRegex?: boolean; matchCase?: boolean; wholeWord?: boolean },
): PositronCellFindMatch[] {
	controller.start();
	return internals(controller).research(
		query,
		opts?.isRegex ?? false,
		opts?.matchCase ?? false,
		opts?.wholeWord ?? false,
	);
}

/**
 * Reactive: start find and set search string on the find instance.
 * Waits for the autorun to settle.
 */
async function reactiveSearch(
	controller: PositronNotebookFindController,
	query: string,
	opts?: { isRegex?: boolean; matchCase?: boolean; wholeWord?: boolean },
): Promise<void> {
	controller.start();
	const fi = getFindInstance(controller);
	if (opts?.isRegex !== undefined) { fi.isRegex.set(opts.isRegex, undefined); }
	if (opts?.matchCase !== undefined) { fi.matchCase.set(opts.matchCase, undefined); }
	if (opts?.wholeWord !== undefined) { fi.wholeWord.set(opts.wholeWord, undefined); }
	fi.searchString.set(query, undefined);
	await timeout(0);
}

/** Read match count from find instance. */
function getMatchCount(controller: PositronNotebookFindController): number {
	return getFindInstance(controller).matchCount.get() ?? 0;
}

/** Read match index from find instance. */
function getMatchIndex(controller: PositronNotebookFindController): number | undefined {
	return getFindInstance(controller).matchIndex.get();
}

/** Read all matches from controller state. */
function getMatches(controller: PositronNotebookFindController): PositronCellFindMatch[] {
	return controller.matches.get();
}

/** Read current match from controller state. */
function getCurrentMatch(controller: PositronNotebookFindController): CurrentPositronCellMatch | undefined {
	return controller.currentMatch.get();
}

/** Select a cell to make it the active cell (required before navigation). */
function selectCell(notebook: TestPositronNotebookInstance, cellIndex: number): void {
	const cells = notebook.cells.get();
	assert.ok(cellIndex < cells.length, `Cell index ${cellIndex} out of range (${cells.length} cells)`);
	notebook.selectionStateMachine.selectCell(cells[cellIndex]);
}

// ============================================================================
// Tests
// ============================================================================

suite('PositronNotebookFindController', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createNotebook(cells: [string, string, CellKind][]): TestPositronNotebookInstance {
		return disposables.add(createTestPositronNotebookEditor(cells));
	}

	function getController(notebook: TestPositronNotebookInstance): PositronNotebookFindController {
		const controller = PositronNotebookFindController.get(notebook);
		assert.ok(controller, 'Find controller should be registered');
		return controller;
	}

	// ========================================================================
	// 1. Matching Logic
	// ========================================================================
	suite('Matching Logic', () => {

		test('finds single match in one code cell', () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, 'hello');
			assert.strictEqual(matches.length, 1);
			assert.strictEqual(getMatchCount(controller), 1);
		});

		test('finds multiple matches in one code cell', () => {
			const notebook = createNotebook([['hello hello hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, 'hello');
			assert.strictEqual(matches.length, 3);
			assert.strictEqual(getMatchCount(controller), 3);
		});

		test('finds matches in markdown cells', () => {
			const notebook = createNotebook([['# Hello World', 'markdown', CellKind.Markup]]);
			const controller = getController(notebook);

			const matches = search(controller, 'Hello');
			assert.strictEqual(matches.length, 1);
		});

		test('finds matches across multiple cells in index order', () => {
			const notebook = createNotebook([
				['alpha beta', 'python', CellKind.Code],
				['gamma', 'python', CellKind.Code],
				['alpha delta', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);

			const matches = search(controller, 'alpha');
			assert.strictEqual(matches.length, 2);
			assert.strictEqual(matches[0].cellRange.cellIndex, 0);
			assert.strictEqual(matches[1].cellRange.cellIndex, 2);
		});

		test('matchCase=false is case-insensitive', () => {
			const notebook = createNotebook([['Hello HELLO hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, 'hello', { matchCase: false });
			assert.strictEqual(matches.length, 3);
		});

		test('matchCase=true is case-sensitive', () => {
			const notebook = createNotebook([['Hello HELLO hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, 'hello', { matchCase: true });
			assert.strictEqual(matches.length, 1);
		});

		test('isRegex=true supports regex patterns', () => {
			const notebook = createNotebook([['foo123 bar456 baz', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, '\\w+\\d+', { isRegex: true });
			assert.strictEqual(matches.length, 2);
		});

		test('isRegex=true with invalid regex fails safely', () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, '[invalid', { isRegex: true });
			assert.strictEqual(matches.length, 0);
			assert.strictEqual(getMatchCount(controller), 0);
			assert.strictEqual(getMatchIndex(controller), undefined);
		});

		test('isRegex=false treats regex symbols literally', () => {
			const notebook = createNotebook([['a.b a*b a+b', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, 'a.b');
			assert.strictEqual(matches.length, 1, 'Should match literal "a.b" only');
		});

		test('wholeWord=true only matches full words', async () => {
			const notebook = createNotebook([['cat catch category', 'python', CellKind.Code]]);
			const configService = notebook.testInstantiationService.get(IConfigurationService) as TestConfigurationService;
			await configService.setUserConfiguration('editor.wordSeparators', USUAL_WORD_SEPARATORS);
			const controller = getController(notebook);

			const matches = search(controller, 'cat', { wholeWord: true });
			assert.strictEqual(matches.length, 1, 'Should match only standalone "cat"');
		});

		test('wholeWord=false allows partial-word matches', () => {
			const notebook = createNotebook([['cat catch category', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, 'cat');
			assert.strictEqual(matches.length, 3, 'Should match "cat" in all words');
		});

		test('empty search string returns zero matches', () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, '');
			assert.strictEqual(matches.length, 0);
			assert.strictEqual(getMatchIndex(controller), undefined);
		});

		test('no-cell notebook returns zero matches', () => {
			const notebook = createNotebook([]);
			const controller = getController(notebook);

			const matches = search(controller, 'hello');
			assert.strictEqual(matches.length, 0);
		});

		test('match ordering is stable: within-cell positions preserved', () => {
			const notebook = createNotebook([['bb aa cc aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			const matches = search(controller, 'aa');
			assert.strictEqual(matches.length, 2);
			// First "aa" at column 4, second "aa" at column 10
			assert.ok(
				matches[0].cellRange.range.startColumn < matches[1].cellRange.range.startColumn,
				'Matches within a cell should be in column order'
			);
		});

		test('reactive: query change triggers research', async () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			await reactiveSearch(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 1);

			// Change query reactively
			getFindInstance(controller).searchString.set('world', undefined);
			await timeout(0);
			assert.strictEqual(getMatchCount(controller), 1);
		});

		test('reactive: toggle change triggers research', async () => {
			const notebook = createNotebook([['Hello hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			await reactiveSearch(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 2, 'case-insensitive should find 2');

			// Toggle matchCase reactively
			getFindInstance(controller).matchCase.set(true, undefined);
			await timeout(0);
			assert.strictEqual(getMatchCount(controller), 1, 'case-sensitive should find 1');
		});
	});

	// ========================================================================
	// 2. Navigation
	// ========================================================================
	suite('Navigation', () => {

		test('findNext advances within same cell', () => {
			const notebook = createNotebook([['aa bb aa bb aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

			controller.findNext();
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 0);

			controller.findNext();
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 1);

			controller.findNext();
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 2);
		});

		test('findPrevious moves backward within same cell', () => {
			const notebook = createNotebook([['aa bb aa bb aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

			// Navigate forward to establish current match
			controller.findNext(); // match 0
			controller.findNext(); // match 1

			controller.findPrevious(); // back to match 0
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 0);
		});

		test('findNext wraps from last to first match', () => {
			const notebook = createNotebook([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

			controller.findNext(); // match 0
			controller.findNext(); // match 1
			controller.findNext(); // wraps to match 0
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 0);
		});

		test('findPrevious wraps from first to last match', () => {
			const notebook = createNotebook([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

			controller.findNext(); // match 0
			controller.findPrevious(); // wraps to match 1 (last)
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 1);
		});

		test('cross-cell navigation moves to correct target match', () => {
			const notebook = createNotebook([
				['alpha', 'python', CellKind.Code],
				['no match', 'python', CellKind.Code],
				['alpha', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'alpha');

			controller.findNext(); // match 0 (cell 0)
			assert.strictEqual(getCurrentMatch(controller)?.cellMatch.cellRange.cellIndex, 0);

			controller.findNext(); // match 1 (cell 2)
			assert.strictEqual(getCurrentMatch(controller)?.cellMatch.cellRange.cellIndex, 2);
		});

		test('navigation sets editor selection', () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'world');

			controller.findNext();
			const cells = notebook.cells.get();
			const selection = getCellSelection(cells[0]);
			// "world" starts at column 7 and ends at column 12
			assert.deepStrictEqual(selection, [1, 7, 1, 12]);
		});

		test('no matches: findNext is no-op', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'xyz');

			controller.findNext();
			assert.strictEqual(getCurrentMatch(controller), undefined);
		});

		test('no matches: findPrevious is no-op', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'xyz');

			controller.findPrevious();
			assert.strictEqual(getCurrentMatch(controller), undefined);
		});

		test('findNext from cursor position when no current match', () => {
			const notebook = createNotebook([['aa bb aa cc aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);

			// Place cursor after the first "aa" (at column 3)
			const cell = notebook.cells.get()[0];
			cell.currentEditor!.setPosition({ lineNumber: 1, column: 4 });

			search(controller, 'aa');

			// findNext should find the next match after cursor position
			controller.findNext();
			const match = getCurrentMatch(controller);
			assert.ok(match);
			// The match at column 7 (second "aa") should be found
			assert.strictEqual(match!.cellMatch.cellRange.range.startColumn, 7);
		});

		test('reactive: onDidRequestFindNext triggers navigation', async () => {
			const notebook = createNotebook([['aa bb aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			await reactiveSearch(controller, 'aa');

			// Simulate the find widget's "next" button via event
			// eslint-disable-next-line local/code-no-any-casts
			(getFindInstance(controller) as any)._onDidRequestFindNext.fire();
			assert.ok(getCurrentMatch(controller), 'Should have navigated to a match');
		});

		test('reactive: onDidRequestFindPrevious triggers navigation', async () => {
			const notebook = createNotebook([['aa bb aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			await reactiveSearch(controller, 'aa');

			// Navigate to first match, then use event to go previous (should wrap)
			controller.findNext(); // match 0
			// eslint-disable-next-line local/code-no-any-casts
			(getFindInstance(controller) as any)._onDidRequestFindPrevious.fire();
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 1, 'Should wrap to last');
		});
	});

	// ========================================================================
	// 3. Notebook Structure Changes
	// ========================================================================
	suite('Notebook Structure Changes', () => {

		test('adding a cell with matching content recomputes matches', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			search(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 1);

			// Add a new cell with matching content
			notebook.addCell(CellKind.Code, 1, false, 'hello again');

			// Re-search (simulates what debounced recompute would do)
			internals(controller).research('hello', false, false, false);
			assert.strictEqual(getMatchCount(controller), 2);
		});

		test('deleting a cell with matches recomputes correctly', () => {
			const notebook = createNotebook([
				['hello', 'python', CellKind.Code],
				['hello', 'python', CellKind.Code],
				['world', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			search(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 2);

			// Delete second cell (which has a match)
			const cells = notebook.cells.get();
			notebook.deleteCell(cells[1]);

			// Re-search
			internals(controller).research('hello', false, false, false);
			assert.strictEqual(getMatchCount(controller), 1);
		});

		test('content edit that removes match recomputes correctly', () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			search(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 1);

			// Edit cell content to remove the match
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('goodbye world');

			// Re-search
			internals(controller).research('hello', false, false, false);
			assert.strictEqual(getMatchCount(controller), 0);
		});

		test('content edit that adds matches recomputes correctly', () => {
			const notebook = createNotebook([['goodbye world', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			search(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 0);

			// Edit cell to add matches
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('hello hello');

			// Re-search
			internals(controller).research('hello', false, false, false);
			assert.strictEqual(getMatchCount(controller), 2);
		});

		test('navigation remains correct after cell deletion', () => {
			const notebook = createNotebook([
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'match');
			assert.strictEqual(getMatchCount(controller), 3);

			// Navigate to first match
			controller.findNext();
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 0);

			// Delete first cell
			const cells = notebook.cells.get();
			notebook.deleteCell(cells[0]);

			// Re-search to update matches
			internals(controller).research('match', false, false, false);
			assert.strictEqual(getMatches(controller).length, 2);

			// Navigation should work on new match set
			controller.findNext();
			assert.ok(getCurrentMatch(controller));
		});

		test('decorations are cleaned up for deleted cells', () => {
			const notebook = createNotebook([
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			search(controller, 'match');

			const cellsBefore = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cellsBefore[0]).length, 1);
			assert.strictEqual(getFindMatchDecorations(cellsBefore[1]).length, 1);

			// Delete first cell
			notebook.deleteCell(cellsBefore[0]);
			internals(controller).research('match', false, false, false);

			// Remaining cell still has decoration
			const cellsAfter = notebook.cells.get();
			assert.strictEqual(cellsAfter.length, 1);
			assert.strictEqual(getFindMatchDecorations(cellsAfter[0]).length, 1);
		});
	});

	// ========================================================================
	// 4. Decorations
	// ========================================================================
	suite('Decorations', () => {

		test('decorations applied for all matches', () => {
			const notebook = createNotebook([
				['aa bb aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			search(controller, 'aa');

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 2);
			assert.strictEqual(getFindMatchDecorations(cells[1]).length, 1);
		});

		test('current match decoration is distinct and updates on navigation', () => {
			const notebook = createNotebook([['aa bb aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

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
			const notebook = createNotebook([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

			const cells = notebook.cells.get();

			controller.findNext(); // match 0 (cell 0)
			assert.ok(getCurrentFindMatchDecoration(cells[0]));
			assert.strictEqual(getCurrentFindMatchDecoration(cells[1]), undefined);

			controller.findNext(); // match 1 (cell 1)
			assert.strictEqual(getCurrentFindMatchDecoration(cells[0]), undefined, 'Cell 0 should lose current decoration');
			assert.ok(getCurrentFindMatchDecoration(cells[1]), 'Cell 1 should gain current decoration');
		});

		test('decorations update when query changes', () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			search(controller, 'hello');

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);
			assert.strictEqual(getFindMatchDecorations(cells[0])[0].range.startColumn, 1);

			// Change search to match 'world'
			internals(controller).research('world', false, false, false);
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);
			assert.strictEqual(getFindMatchDecorations(cells[0])[0].range.startColumn, 7);
		});

		test('decorations clear when query is emptied', () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			search(controller, 'hello');

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);

			// Empty the search
			internals(controller).research('', false, false, false);
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 0);
		});

		test('decorations clear when find is hidden', async () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			await reactiveSearch(controller, 'hello');

			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 1);

			// Hide find widget
			controller.hide();
			await timeout(0);
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, 0, 'Decorations should clear on hide');
		});

		test('decoration count matches found matches', () => {
			const notebook = createNotebook([
				['aaa', 'python', CellKind.Code],
			]);
			const controller = getController(notebook);

			const matches = search(controller, 'a');
			const cells = notebook.cells.get();
			assert.strictEqual(getFindMatchDecorations(cells[0]).length, matches.length);
		});
	});

	// ========================================================================
	// 5. Focus and Visibility
	// ========================================================================
	suite('Focus and Visibility', () => {

		test('starting find makes widget visible', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
			const fi = getFindInstance(controller);
			assert.strictEqual(fi.isVisible.get(), true);
		});

		test('hiding find makes widget not visible', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
			assert.strictEqual(getFindInstance(controller).isVisible.get(), true);

			controller.hide();
			assert.strictEqual(getFindInstance(controller).isVisible.get(), false);
		});

		test('starting find twice reuses same instance', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
			const fi1 = controller.findInstance;
			controller.start();
			const fi2 = controller.findInstance;
			assert.strictEqual(fi1, fi2, 'Should reuse same find instance');
		});

		test('hiding find clears matches and current match', async () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			await reactiveSearch(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 1);

			controller.hide();
			await timeout(0);
			assert.strictEqual(getMatches(controller).length, 0);
			assert.strictEqual(getCurrentMatch(controller), undefined);
		});

		test('context key FIND_WIDGET_VISIBLE toggles correctly', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
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
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
			// After show(), inputFocused is set to true
			assert.strictEqual(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_INPUT_FOCUSED.key),
				true
			);
		});

		test('detaching view hides find widget', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
			assert.strictEqual(getFindInstance(controller).isVisible.get(), true);

			// Detach view
			notebook.detachView();
			assert.strictEqual(getFindInstance(controller).isVisible.get(), false);
		});
	});

	// ========================================================================
	// 6. State Isolation
	// ========================================================================
	// Note: Multi-notebook-instance tests are not feasible in this test harness
	// because creating 2 notebook instances causes disposable tracking conflicts
	// in the shared workbench service layer. State isolation between instances is
	// verified indirectly through the per-instance controller/decoration architecture
	// and through single-instance lifecycle tests above.
	suite('State Isolation', () => {

		test('controller state is scoped to its notebook instance', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			search(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 1);

			// Matches reference the correct cell from the notebook
			assert.strictEqual(getMatches(controller)[0].cell, notebook.cells.get()[0]);
		});

		test('hiding and restarting find resets state cleanly', async () => {
			const notebook = createNotebook([['alpha beta', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			// First search
			await reactiveSearch(controller, 'alpha');
			assert.strictEqual(getMatchCount(controller), 1);

			// Hide clears state
			controller.hide();
			await timeout(0);
			assert.strictEqual(getMatches(controller).length, 0);
			assert.strictEqual(getCurrentMatch(controller), undefined);

			// Second search - completely fresh results
			await reactiveSearch(controller, 'beta');
			assert.strictEqual(getMatchCount(controller), 1);
			assert.strictEqual(getMatches(controller)[0].cellRange.range.startColumn, 7);
		});
	});

	// ========================================================================
	// 7. Debounce and Reactive Updates
	// ========================================================================
	suite('Debounce and Reactive Updates', () => {
		// Note: In the test environment, textModel.setValue() does not
		// propagate to NotebookTextModel.onDidChangeContent because the
		// cell text model resolution path differs from production.
		// We simulate content change propagation by manually scheduling
		// the controller's debounce scheduler after editing content.

		/** Simulate the debounced content change that would fire in production. */
		function triggerContentChangeDebounce(controller: PositronNotebookFindController): void {
			internals(controller)._notebookContentChangedScheduler.schedule();
		}

		test('content change triggers debounced recompute', async () => {
			const notebook = createNotebook([['hello world', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			await reactiveSearch(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 1);

			// Modify cell content and trigger the debounce scheduler
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('hello hello hello');
			triggerContentChangeDebounce(controller);

			// After debounce settles (20ms), should recompute
			await timeout(50);
			assert.strictEqual(getMatchCount(controller), 3, 'Should have recomputed after debounce');
		});

		test('search param change triggers immediate recompute', async () => {
			const notebook = createNotebook([['hello Hello HELLO', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			await reactiveSearch(controller, 'hello');
			assert.strictEqual(getMatchCount(controller), 3, 'Case-insensitive finds all');

			// Toggle matchCase - triggers immediate recompute via autorun (not debounced)
			getFindInstance(controller).matchCase.set(true, undefined);
			await timeout(0);
			assert.strictEqual(getMatchCount(controller), 1, 'Case-sensitive finds only lowercase');
		});

		test('rapid content changes settle to correct final state', async () => {
			const notebook = createNotebook([['initial', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			await reactiveSearch(controller, 'final');
			assert.strictEqual(getMatchCount(controller), 0);

			// Rapid edits with debounce scheduling after each
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('first');
			triggerContentChangeDebounce(controller);
			cell.model.textModel!.setValue('second');
			triggerContentChangeDebounce(controller);
			cell.model.textModel!.setValue('final content');
			triggerContentChangeDebounce(controller);

			// Wait for debounce to settle - only final state matters
			await timeout(50);
			assert.strictEqual(getMatchCount(controller), 1, 'Should find "final" in final content');
		});
	});

	// ========================================================================
	// 8. Command/Action Smoke
	// ========================================================================
	suite('Command/Action Smoke', () => {

		test('start shows the widget', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
			assert.strictEqual(getFindInstance(controller).isVisible.get(), true);
		});

		test('hide hides the widget', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			controller.start();
			controller.hide();
			assert.strictEqual(getFindInstance(controller).isVisible.get(), false);
		});

		test('findNext navigates to match', () => {
			const notebook = createNotebook([['aa bb', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

			controller.findNext();
			assert.ok(getCurrentMatch(controller));
		});

		test('findPrevious navigates to match', () => {
			const notebook = createNotebook([['aa bb aa', 'python', CellKind.Code]]);
			const controller = getController(notebook);
			selectCell(notebook, 0);
			search(controller, 'aa');

			controller.findNext(); // first match
			controller.findPrevious(); // wraps to last
			assert.strictEqual(getCurrentMatch(controller)?.matchIndex, 1);
		});

		test('hide before start is no-op', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			// Should not throw
			controller.hide();
			assert.strictEqual(controller.findInstance, undefined);
		});
	});
});
