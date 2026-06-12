/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Register the find contribution
import '../../../../browser/contrib/find/positronNotebookFind.contribution.js';

import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
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
import { instantiateTestNotebookInstance, TestPositronNotebookInstance } from '../../testPositronNotebookInstance.js';
import { transaction } from '../../../../../../../base/common/observable.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { Disposable, IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../../../base/test/common/timeTravelScheduler.js';

/** Get the find controller for a notebook. */
function getController(notebook: TestPositronNotebookInstance): PositronNotebookFindController {
	const controller = PositronNotebookFindController.get(notebook);
	expect(controller, 'Find controller should be registered').toBeDefined();
	return controller!;
}

/** Gets the find instance, starting the controller if needed. */
function getOrStartFindInstance(controller: PositronNotebookFindController): PositronFindInstance {
	let find = controller.findInstance;

	// Start if not already started
	if (!find) {
		controller.start();
		find = controller.findInstance;
	}

	expect(find, 'Unexpected Error: Find instance should exist after controller.start()').toBeDefined();
	return find!;
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

describe('PositronNotebookFindController', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		.build();

	let bulkEditApplySpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		const bulkEditService = new TestBulkEditService(ctx.get(IModelService));
		bulkEditApplySpy = vi.spyOn(bulkEditService, 'apply');
		ctx.instantiationService.stub(IBulkEditService, bulkEditService);
	});

	function createNotebook(cells: [string, string, CellKind][]) {
		return instantiateTestNotebookInstance(cells, ctx.instantiationService, ctx.disposables);
	}

	function findFixture(cells: [string, string, CellKind][]) {
		const notebook = createNotebook(cells);
		const controller = getController(notebook);
		const find = getOrStartFindInstance(controller);
		return { notebook, controller, find };
	}

	describe('Matching Logic', () => {

		it('finds single match in one code cell', () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);

			expect(controller.matches.get().length).toBe(1);
			expect(find.matchCount.get()).toBe(1);
			expect(find.matchIndex.get()).toBe(0);
		});

		it('finds multiple matches in one code cell', () => {
			const { controller, find } = findFixture([['hello hello hello', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);

			expect(controller.matches.get().length).toBe(3);
			expect(find.matchCount.get()).toBe(3);
			expect(find.matchIndex.get()).toBe(0);
		});

		it('finds matches in markdown cells', () => {
			const { controller, find } = findFixture([['# Hello World', 'markdown', CellKind.Markup]]);

			find.searchString.set('Hello', undefined);

			expect(controller.matches.get().length).toBe(1);
		});

		it('finds matches across multiple cells in index order', () => {
			const { controller, find } = findFixture([
				['alpha beta', 'python', CellKind.Code],
				['gamma', 'python', CellKind.Code],
				['alpha delta', 'python', CellKind.Code],
			]);

			find.searchString.set('alpha', undefined);

			const matches = controller.matches.get();
			expect(matches.length).toBe(2);
			expect(matches[0].cellRange.cellIndex).toBe(0);
			expect(matches[1].cellRange.cellIndex).toBe(2);
		});

		it('matchCase=false is case-insensitive', () => {
			const { controller, find } = findFixture([['Hello HELLO hello', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);

			expect(controller.matches.get().length).toBe(3);
		});

		it('matchCase=true is case-sensitive', () => {
			const { controller, find } = findFixture([['Hello HELLO hello', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.matchCase.set(true, tx);
				find.searchString.set('hello', tx);
			});

			expect(controller.matches.get().length).toBe(1);
		});

		it('isRegex=true supports regex patterns', () => {
			const { controller, find } = findFixture([['foo123 bar456 baz', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('\\w+\\d+', tx);
			});

			expect(controller.matches.get().length).toBe(2);
		});

		it('isRegex=true with invalid regex fails safely', () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('[invalid', tx);
			});

			expect(controller.matches.get().length).toBe(0);
			expect(find.matchCount.get()).toBe(0);
			expect(find.matchIndex.get()).toBe(undefined);
		});

		it('isRegex=false treats regex symbols literally', () => {
			const { controller, find } = findFixture([['a.b a*b a+b', 'python', CellKind.Code]]);

			find.searchString.set('a.b', undefined);

			expect(controller.matches.get().length, 'Should match literal "a.b" only').toBe(1);
		});

		it('wholeWord=true only matches full words', async () => {
			const { notebook, controller, find } = findFixture([['cat catch category', 'python', CellKind.Code]]);
			const configService = notebook.instantiationService.invokeFunction(accessor => accessor.get(IConfigurationService)) as TestConfigurationService;
			await configService.setUserConfiguration('editor.wordSeparators', USUAL_WORD_SEPARATORS);

			transaction((tx) => {
				find.wholeWord.set(true, tx);
				find.searchString.set('cat', tx);
			});

			expect(controller.matches.get().length, 'Should match only standalone "cat"').toBe(1);
		});

		it('wholeWord=false allows partial-word matches', () => {
			const { controller, find } = findFixture([['cat catch category', 'python', CellKind.Code]]);

			find.searchString.set('cat', undefined);

			expect(controller.matches.get().length, 'Should match "cat" in all words').toBe(3);
		});

		it('empty search string returns zero matches', () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);

			find.searchString.set('', undefined);

			expect(controller.matches.get().length).toBe(0);
			expect(find.matchIndex.get()).toBe(undefined);
		});

		it('no-cell notebook returns zero matches', () => {
			const { controller, find } = findFixture([]);

			find.searchString.set('hello', undefined);

			expect(controller.matches.get().length).toBe(0);
		});

		it('match ordering is stable: within-cell positions preserved', () => {
			const { controller, find } = findFixture([['bb aa cc aa', 'python', CellKind.Code]]);

			find.searchString.set('aa', undefined);

			const matches = controller.matches.get();
			expect(matches.length).toBe(2);
			// First "aa" at column 4, second "aa" at column 10
			expect(
				matches[0].cellRange.isBefore(matches[1].cellRange),
				'Matches within a cell should be in column order',
			).toBe(true);
		});

		it('reactive: query change triggers research', () => {
			const { find } = findFixture([['hello world', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);
			expect(find.matchCount.get()).toBe(1);

			// Change query reactively -- autorun fires synchronously
			find.searchString.set('good bye', undefined);
			expect(find.matchCount.get()).toBe(0);
		});

		it('reactive: toggle change triggers research', () => {
			const { find } = findFixture([['Hello hello', 'python', CellKind.Code]]);

			find.searchString.set('hello', undefined);
			expect(find.matchCount.get(), 'case-insensitive should find 2').toBe(2);

			// Toggle matchCase reactively -- autorun fires synchronously
			find.matchCase.set(true, undefined);
			expect(find.matchCount.get(), 'case-sensitive should find 1').toBe(1);
		});
	});

	describe('Navigation', () => {

		it('findNext advances within same cell', () => {
			const { controller, find } = findFixture([['aa bb aa bb aa', 'python', CellKind.Code]]);
			find.searchString.set('aa', undefined);

			controller.findNext();
			expect(controller.currentMatch.get()?.matchIndex).toBe(0);

			controller.findNext();
			expect(controller.currentMatch.get()?.matchIndex).toBe(1);

			controller.findNext();
			expect(controller.currentMatch.get()?.matchIndex).toBe(2);
		});

		it('findPrevious moves backward within same cell', () => {
			const { controller, find } = findFixture([['aa bb aa bb aa', 'python', CellKind.Code]]);
			find.searchString.set('aa', undefined);

			// Navigate forward to establish current match
			controller.findNext(); // match 0
			controller.findNext(); // match 1

			controller.findPrevious(); // back to match 0
			expect(controller.currentMatch.get()?.matchIndex).toBe(0);
		});

		it('findNext wraps from last to first match', () => {
			const { controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			controller.findNext(); // match 0
			controller.findNext(); // match 1
			controller.findNext(); // wraps to match 0
			expect(controller.currentMatch.get()?.matchIndex).toBe(0);
		});

		it('findPrevious wraps from first to last match', () => {
			const { controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			controller.findNext(); // match 0
			controller.findPrevious(); // wraps to match 1 (last)
			expect(controller.currentMatch.get()?.matchIndex).toBe(1);
		});

		it('cross-cell navigation moves to correct target match', () => {
			const { controller, find } = findFixture([
				['alpha', 'python', CellKind.Code],
				['no match', 'python', CellKind.Code],
				['alpha', 'python', CellKind.Code],
			]);
			find.searchString.set('alpha', undefined);

			controller.findNext(); // match 0 (cell 0)
			expect(controller.currentMatch.get()?.cellMatch.cellRange.cellIndex).toBe(0);

			controller.findNext(); // match 1 (cell 2)
			expect(controller.currentMatch.get()?.cellMatch.cellRange.cellIndex).toBe(2);
		});

		it('navigation sets editor selection', () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('world', undefined);

			controller.findNext();
			const cells = notebook.cells.get();
			const selection = getCellSelection(cells[0]);
			// "world" starts at column 7 and ends at column 12
			expect(selection).toEqual([1, 7, 1, 12]);
		});

		it('no matches: findNext is no-op', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('xyz', undefined);

			controller.findNext();
			expect(controller.currentMatch.get()).toBe(undefined);
		});

		it('no matches: findPrevious is no-op', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('xyz', undefined);

			controller.findPrevious();
			expect(controller.currentMatch.get()).toBe(undefined);
		});

		it('findNext from cursor position when no current match', () => {
			const { notebook, controller, find } = findFixture([['aa bb aa cc aa', 'python', CellKind.Code]]);

			// Place cursor after the first "aa" (at column 3)
			const cell = notebook.cells.get()[0];
			cell.currentEditor!.setPosition({ lineNumber: 1, column: 4 });

			find.searchString.set('aa', undefined);

			// findNext should find the next match after cursor position
			controller.findNext();
			const match = controller.currentMatch.get();
			expect(match).toBeDefined();
			// The match at column 7 (second "aa") should be found
			expect(match!.cellMatch.cellRange.range.startColumn).toBe(7);
		});

		// Regression: findNext() was a no-op when the cursor was past all
		// matches because findNextMatchFromCursor() returned -1 instead of
		// wrapping to the first match.
		it('findNext wraps to first match when cursor is past all matches', () => {
			const { notebook, controller, find } = findFixture([['aa bb', 'python', CellKind.Code]]);

			// Place cursor at column 4 ('aa |bb') -- past the only 'aa' match
			const cell = notebook.cells.get()[0];
			cell.currentEditor!.setPosition({ lineNumber: 1, column: 4 });

			find.searchString.set('aa', undefined);

			expect(find.matchCount.get()).toBe(1);
			expect(find.matchIndex.get()).toBe(0);
			expect(controller.currentMatch.get(), 'research sets matchIndex but not currentMatch').toBe(undefined);

			controller.findNext();
			const match = controller.currentMatch.get();
			expect(match, 'findNext should wrap to the first match').toBeDefined();
			expect(match!.matchIndex).toBe(0);
			expect(match!.cellMatch.cellRange.range.startColumn).toBe(1);
		});

	});

	describe('Match Reveal', () => {

		it('navigating to a match on a later line selects that line in the editor', () => {
			const { notebook, controller, find } = findFixture([
				['line one\nline two\ntarget here', 'python', CellKind.Code],
			]);
			find.searchString.set('target', undefined);

			controller.findNext();

			expect(getCellSelection(notebook.cells.get()[0])).toEqual([3, 1, 3, 7]);
		});

		it('navigating to a match requests an editor reveal of the match line', () => {
			const { notebook, controller, find } = findFixture([
				['line one\nline two\ntarget here', 'python', CellKind.Code],
			]);
			const revealSpy = vi.spyOn(notebook.cells.get()[0].currentEditor!, 'revealRangeInCenter');
			find.searchString.set('target', undefined);

			controller.findNext();

			expect(revealSpy).toHaveBeenCalledWith(expect.objectContaining({ startLineNumber: 3 }));
		});

		it('navigating to a match in another cell requests a cell reveal', () => {
			const { notebook, controller, find } = findFixture([
				['alpha', 'python', CellKind.Code],
				['target', 'python', CellKind.Code],
			]);
			const revealSpy = vi.spyOn(notebook, 'revealInCenterIfOutsideViewport');
			find.searchString.set('target', undefined);

			controller.findNext();

			expect(revealSpy).toHaveBeenCalledWith(notebook.cells.get()[1]);
		});

		// https://github.com/posit-dev/positron/issues/14130: find jumps to the
		// right cell but not the matching line. `navigateToMatch()` only sets the
		// selection and reveals the line when the cell already has an attached
		// editor; for a cell whose editor attaches late (e.g. it was outside the
		// viewport when the search navigated to it), the line reveal is skipped
		// and never retried. These tests document the expected behavior and are
		// marked `fails` until the bug is fixed -- flip them to `it` then.

		it.fails('applies the match selection once a late-attaching editor attaches', () => {
			const { notebook, controller, find } = findFixture([
				['alpha', 'python', CellKind.Code],
				['line one\nline two\ntarget here', 'python', CellKind.Code],
			]);
			const cell = notebook.cells.get()[1];
			const editor = cell.currentEditor!;
			cell.detachEditor();

			find.searchString.set('target', undefined);
			controller.findNext();
			cell.attachEditor(editor);

			expect(getCellSelection(cell)).toEqual([3, 1, 3, 7]);
		});

		it.fails('requests an editor reveal once a late-attaching editor attaches', () => {
			const { notebook, controller, find } = findFixture([
				['alpha', 'python', CellKind.Code],
				['line one\nline two\ntarget here', 'python', CellKind.Code],
			]);
			const cell = notebook.cells.get()[1];
			const editor = cell.currentEditor!;
			const revealSpy = vi.spyOn(editor, 'revealRangeInCenter');
			cell.detachEditor();

			find.searchString.set('target', undefined);
			controller.findNext();
			cell.attachEditor(editor);

			expect(revealSpy).toHaveBeenCalledWith(expect.objectContaining({ startLineNumber: 3 }));
		});

	});

	describe('Notebook Structure Changes', () => {

		it('adding a cell with matching content recomputes matches', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			expect(find.matchCount.get()).toBe(1);

			// Add a new cell with matching content
			notebook.addCell(CellKind.Code, 1, false, 'hello again');

			// Structural change triggers debounced recompute
			await waitForDebounce();
			expect(find.matchCount.get()).toBe(2);
		}));

		it('deleting a cell with matches recomputes correctly', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([
				['hello', 'python', CellKind.Code],
				['hello', 'python', CellKind.Code],
				['world', 'python', CellKind.Code],
			]);
			find.searchString.set('hello', undefined);
			expect(find.matchCount.get()).toBe(2);

			// Delete second cell (which has a match)
			const cells = notebook.cells.get();
			notebook.deleteCell(cells[1]);

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(1);
		}));

		it('content edit that removes match recomputes correctly', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			expect(find.matchCount.get()).toBe(1);

			// Edit cell content to remove the match
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('goodbye world');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(0);
		}));

		it('content edit that adds matches recomputes correctly', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['goodbye world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			expect(find.matchCount.get()).toBe(0);

			// Edit cell to add matches
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('hello hello');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(2);
		}));

		it('navigation remains correct after cell deletion', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
			]);
			find.searchString.set('match', undefined);
			expect(find.matchCount.get()).toBe(3);

			// Navigate to first match
			controller.findNext();
			expect(controller.currentMatch.get()?.matchIndex).toBe(0);

			// Delete first cell
			const cells = notebook.cells.get();
			notebook.deleteCell(cells[0]);

			await waitForDebounce();
			expect(controller.matches.get().length).toBe(2);

			// Navigation should work on new match set
			controller.findNext();
			expect(controller.currentMatch.get()).toBeDefined();
		}));

		it('decorations are cleaned up for deleted cells', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([
				['match', 'python', CellKind.Code],
				['match', 'python', CellKind.Code],
			]);
			find.searchString.set('match', undefined);

			const cellsBefore = notebook.cells.get();
			expect(getFindMatchDecorations(cellsBefore[0]).length).toBe(1);
			expect(getFindMatchDecorations(cellsBefore[1]).length).toBe(1);

			// Delete first cell
			notebook.deleteCell(cellsBefore[0]);

			await waitForDebounce();

			// Remaining cell still has decoration
			const cellsAfter = notebook.cells.get();
			expect(cellsAfter.length).toBe(1);
			expect(getFindMatchDecorations(cellsAfter[0]).length).toBe(1);
		}));
	});

	describe('Decorations', () => {

		it('decorations applied for all matches', () => {
			const { notebook, find } = findFixture([
				['aa bb aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			const cells = notebook.cells.get();
			expect(getFindMatchDecorations(cells[0]).length).toBe(2);
			expect(getFindMatchDecorations(cells[1]).length).toBe(1);
		});

		it('current match decoration is distinct and updates on navigation', () => {
			const { notebook, controller, find } = findFixture([['aa bb aa', 'python', CellKind.Code]]);
			find.searchString.set('aa', undefined);

			const cells = notebook.cells.get();

			// Before navigation, no current match decoration
			expect(getCurrentFindMatchDecoration(cells[0])).toBe(undefined);

			controller.findNext(); // match 0
			const currentDec = getCurrentFindMatchDecoration(cells[0]);
			expect(currentDec, 'Should have current match decoration').toBeDefined();
			expect(currentDec!.range.startColumn).toBe(1);

			controller.findNext(); // match 1
			const nextDec = getCurrentFindMatchDecoration(cells[0]);
			expect(nextDec, 'Should still have current match decoration').toBeDefined();
			expect(nextDec!.range.startColumn, 'Decoration should move to second "aa"').toBe(7);
		});

		it('current match decoration moves across cells', () => {
			const { notebook, controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			find.searchString.set('aa', undefined);

			const cells = notebook.cells.get();

			controller.findNext(); // match 0 (cell 0)
			expect(getCurrentFindMatchDecoration(cells[0])).toBeDefined();
			expect(getCurrentFindMatchDecoration(cells[1])).toBe(undefined);

			controller.findNext(); // match 1 (cell 1)
			expect(getCurrentFindMatchDecoration(cells[0]), 'Cell 0 should lose current decoration').toBe(undefined);
			expect(getCurrentFindMatchDecoration(cells[1]), 'Cell 1 should gain current decoration').toBeDefined();
		});

		it('decorations update when query changes', () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);

			const cells = notebook.cells.get();
			expect(getFindMatchDecorations(cells[0]).length).toBe(1);
			expect(getFindMatchDecorations(cells[0])[0].range.startColumn).toBe(1);

			// Change search to match 'world' -- autorun fires synchronously
			find.searchString.set('world', undefined);
			expect(getFindMatchDecorations(cells[0]).length).toBe(1);
			expect(getFindMatchDecorations(cells[0])[0].range.startColumn).toBe(7);
		});

		it('decorations clear when query is emptied', () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);

			const cells = notebook.cells.get();
			expect(getFindMatchDecorations(cells[0]).length).toBe(1);

			// Empty the search -- autorun fires synchronously
			find.searchString.set('', undefined);
			expect(getFindMatchDecorations(cells[0]).length).toBe(0);
		});

		it('decorations clear when find is hidden', () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);

			const cells = notebook.cells.get();
			expect(getFindMatchDecorations(cells[0]).length).toBe(1);

			// Hide find widget -- autorun clears matches synchronously
			controller.hide();
			expect(getFindMatchDecorations(cells[0]).length, 'Decorations should clear on hide').toBe(0);
		});

		it('decoration count matches found matches', () => {
			const { notebook, controller, find } = findFixture([
				['aaa', 'python', CellKind.Code],
			]);

			find.searchString.set('a', undefined);

			const cells = notebook.cells.get();
			expect(getFindMatchDecorations(cells[0]).length).toBe(controller.matches.get().length);
		});
	});

	describe('Focus and Visibility', () => {

		it('starting find makes widget visible', () => {
			const { find } = findFixture([['hello', 'python', CellKind.Code]]);
			expect(find.isVisible.get()).toBe(true);
		});

		it('hiding find makes widget not visible', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			expect(find.isVisible.get()).toBe(true);

			controller.hide();
			expect(find.isVisible.get()).toBe(false);
		});

		it('starting find twice reuses same instance', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);

			const fi1 = controller.findInstance;
			controller.start();
			const fi2 = controller.findInstance;
			expect(fi1, 'Should reuse same find instance').toBe(fi2);
			expect(fi1).toBe(find);
		});

		it('hiding find clears matches and current match', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			expect(find.matchCount.get()).toBe(1);

			controller.hide();
			expect(controller.matches.get().length).toBe(0);
			expect(controller.currentMatch.get()).toBe(undefined);
		});

		it('context key FIND_WIDGET_VISIBLE toggles correctly', () => {
			const { notebook, controller } = findFixture([['hello', 'python', CellKind.Code]]);

			expect(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_WIDGET_VISIBLE.key)
			).toBe(true);

			controller.hide();
			expect(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_WIDGET_VISIBLE.key)
			).toBe(false);
		});

		it('context key FIND_INPUT_FOCUSED is true immediately after show', () => {
			// Must be set synchronously so that cells don't consume keyboard
			// events (e.g. Enter to edit the active cell) before the find
			// widget's keybindings take effect.
			const { notebook } = findFixture([['hello', 'python', CellKind.Code]]);

			expect(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_INPUT_FOCUSED.key)
			).toBe(true);
		});

		it('context key FIND_INPUT_FOCUSED is false after hide', () => {
			const { notebook, controller } = findFixture([['hello', 'python', CellKind.Code]]);

			// Verify hide resets the context key.
			controller.hide();
			expect(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_FIND_INPUT_FOCUSED.key)
			).toBe(false);
		});

		it('context key REPLACE_INPUT_FOCUSED is false after show and false after hide', () => {
			const { notebook, controller } = findFixture([['hello', 'python', CellKind.Code]]);

			// After show(), replace input is not focused
			expect(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_REPLACE_INPUT_FOCUSED.key)
			).toBe(false);

			// Hide keeps it false
			controller.hide();
			expect(
				notebook.scopedContextKeyService.getContextKeyValue(CONTEXT_REPLACE_INPUT_FOCUSED.key)
			).toBe(false);
		});

		it('detaching view hides find widget', () => {
			const { notebook, find } = findFixture([['hello', 'python', CellKind.Code]]);
			expect(find.isVisible.get()).toBe(true);

			// Detach view
			notebook.detachView();
			expect(find.isVisible.get()).toBe(false);
		});

		it('hide resets replace visibility', () => {
			const { controller, find } = findFixture([['hello', 'python', CellKind.Code]]);

			// Show with replace visible
			controller.start({ replace: true });
			expect(find.replaceIsVisible.get()).toBe(true);

			// Hide and re-show without replace
			controller.hide();
			controller.start();
			expect(find.replaceIsVisible.get()).toBe(false);
		});

		it('hide before start is no-op', () => {
			const notebook = createNotebook([['hello', 'python', CellKind.Code]]);
			const controller = getController(notebook);

			// Should not throw
			controller.hide();
			expect(controller.findInstance).toBe(undefined);
		});
	});

	describe('State Isolation', () => {

		it('two notebooks maintain independent match state', () => {
			const notebook1 = createNotebook([['hello', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['world', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('hello', undefined);
			expect(find1.matchCount.get()).toBe(1);
			expect(controller2.findInstance, 'nb2 controller should have no find instance yet').toBe(undefined);

			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('world', undefined);
			expect(find2.matchCount.get()).toBe(1);
			expect(find1.matchCount.get(), 'nb1 match count unchanged').toBe(1);
		});

		it('matches reference cells from their own notebook', () => {
			const notebook1 = createNotebook([['shared term', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['shared term', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('shared', undefined);
			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('shared', undefined);

			expect(controller1.matches.get()[0].cell).toBe(notebook1.cells.get()[0]);
			expect(controller2.matches.get()[0].cell).toBe(notebook2.cells.get()[0]);
			expect(controller1.matches.get()[0].cell).not.toBe(controller2.matches.get()[0].cell);
		});

		it('decorations are independent across notebooks', () => {
			const notebook1 = createNotebook([['aaa', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['bbb', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('aaa', undefined);
			expect(getFindMatchDecorations(notebook1.cells.get()[0]).length, 'nb1 should have decorations').toBeGreaterThan(0);
			expect(getFindMatchDecorations(notebook2.cells.get()[0]).length, 'nb2 should have no decorations').toBe(0);

			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('bbb', undefined);
			expect(getFindMatchDecorations(notebook2.cells.get()[0]).length, 'nb2 should now have decorations').toBeGreaterThan(0);
			expect(getFindMatchDecorations(notebook1.cells.get()[0]).length, 'nb1 decorations should be unchanged').toBeGreaterThan(0);
		});

		it('hiding find in one notebook does not affect the other', () => {
			const notebook1 = createNotebook([['foo', 'python', CellKind.Code]]);
			const notebook2 = createNotebook([['foo', 'python', CellKind.Code]]);
			const controller1 = getController(notebook1);
			const controller2 = getController(notebook2);

			const find1 = getOrStartFindInstance(controller1);
			find1.searchString.set('foo', undefined);
			const find2 = getOrStartFindInstance(controller2);
			find2.searchString.set('foo', undefined);

			controller1.hide();
			expect(controller1.matches.get().length, 'nb1 matches should be cleared').toBe(0);
			expect(find2.matchCount.get(), 'nb2 matches should be unaffected').toBe(1);
		});
	});

	describe('Debounce and Reactive Updates', () => {

		it('content change triggers debounced recompute', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			// Set up search -- autorun fires synchronously when observables change
			find.searchString.set('hello', undefined);
			expect(find.matchCount.get()).toBe(1);

			// setValue() propagates through the event chain:
			// TextModel -> NotebookCellTextModel -> NotebookTextModel -> controller debounce
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('hello hello hello');

			// Matches haven't updated yet -- debounce hasn't fired
			expect(find.matchCount.get(), 'Should not recompute before debounce fires').toBe(1);

			// Advance past the 20ms debounce
			await waitForDebounce();
			expect(find.matchCount.get(), 'Should have recomputed after debounce').toBe(3);
		}));

		it('search param change triggers immediate recompute', () => {
			const { find } = findFixture([['hello Hello HELLO', 'python', CellKind.Code]]);
			find.searchString.set('hello', undefined);
			expect(find.matchCount.get(), 'Case-insensitive finds all').toBe(3);

			// Toggle matchCase -- triggers immediate recompute via autorun (not debounced)
			find.matchCase.set(true, undefined);
			expect(find.matchCount.get(), 'Case-sensitive finds only lowercase').toBe(1);
		});

		it('rapid content changes settle to correct final state', () => runWithFakedTimers({}, async () => {
			const { notebook, find } = findFixture([['initial', 'python', CellKind.Code]]);
			find.searchString.set('final', undefined);
			expect(find.matchCount.get()).toBe(0);

			// Rapid edits -- each setValue() reschedules the debounce
			const cell = notebook.cells.get()[0];
			cell.model.textModel!.setValue('first');
			cell.model.textModel!.setValue('second');
			cell.model.textModel!.setValue('final content');

			// Advance past the 20ms debounce -- only final state matters
			await waitForDebounce();
			expect(find.matchCount.get(), 'Should find "final" in final content').toBe(1);
		}));
	});

	describe('Replace Single Match', () => {

		it('replace() with no current match navigates to first match without replacing', async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});
			expect(find.matchCount.get()).toBe(2);

			// No current match yet -- replace should just navigate
			await controller.replace();

			expect(controller.currentMatch.get()?.matchIndex).toBe(0);
			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue(), 'Text should be unchanged').toBe('hello world hello');
		});

		it('replace() with current match replaces it and advances to next', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});

			// Navigate to first match
			controller.findNext();
			expect(controller.currentMatch.get()?.matchIndex).toBe(0);

			// Replace
			await controller.replace();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('goodbye world hello');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(1);
		}));

		it('replace() with current match on last match wraps to first', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});

			// Navigate to last match (index 1)
			controller.findNext();
			controller.findNext();
			expect(controller.currentMatch.get()?.matchIndex).toBe(1);

			// Replace last match
			await controller.replace();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('hello world goodbye');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(1);
			// Should wrap to match 0 (the remaining 'hello')
			expect(controller.currentMatch.get()?.matchIndex).toBe(0);
		}));

		it('replace() does nothing when there are no matches', async () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('xyz', tx);
				find.replaceText.set('replaced', tx);
			});
			expect(find.matchCount.get()).toBe(0);

			await controller.replace();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('hello world');
			expect(controller.currentMatch.get()).toBe(undefined);
			expect(bulkEditApplySpy, 'IBulkEditService.apply should not be called').not.toHaveBeenCalled();
		});

		it('replace() uses literal text when regex is off', async () => {
			const { notebook, controller, find } = findFixture([['foo123 bar', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('foo123', tx);
				find.replaceText.set('$1-replaced', tx);
			});

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			// '$1' should be treated literally, not as a capture group
			expect(cell.model.textModel!.getValue()).toBe('$1-replaced bar');
		});

		it('replace() uses capture groups when regex is on', async () => {
			const { notebook, controller, find } = findFixture([['foo123 bar456', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('(\\w+?)(\\d+)', tx);
				find.replaceText.set('$2-$1', tx);
			});

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('123-foo bar456');
		});

		it('replace() with preserveCase inherits casing from matched text', async () => {
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
			expect(cell.model.textModel!.getValue()).toBe('Goodbye world');
		});

		it('replace() calls IBulkEditService.apply with correct ResourceTextEdit', async () => {
			const { controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('hi', tx);
			});

			controller.findNext();
			await controller.replace();

			expect(bulkEditApplySpy, 'apply should be called once').toHaveBeenCalledOnce();
			const edits = bulkEditApplySpy.mock.calls[0][0];
			expect(edits.length).toBe(1);
			expect(edits[0].textEdit.text).toBe('hi');
			// 'hello' is at [1,1 -> 1,6]
			expect(edits[0].textEdit.range.startLineNumber).toBe(1);
			expect(edits[0].textEdit.range.startColumn).toBe(1);
			expect(edits[0].textEdit.range.endLineNumber).toBe(1);
			expect(edits[0].textEdit.range.endColumn).toBe(6);
			// Check options label
			const options = bulkEditApplySpy.mock.calls[0][1];
			expect(options.quotableLabel).toBe('Notebook Replace');
		});

		it('replace() triggers research via content change debounce', () => runWithFakedTimers({}, async () => {
			const { controller, find } = findFixture([['hello hello hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});
			expect(find.matchCount.get()).toBe(3);

			controller.findNext();
			await controller.replace();

			// After debounce, match count should update
			await waitForDebounce();
			expect(find.matchCount.get()).toBe(2);
		}));

		// Matches upstream text-editor behavior (findModel.ts): the first
		// replace() call after a fresh search navigates to the match; the
		// second call performs the actual replacement.
		it('replace() after fresh search navigates first, then replaces on second call', async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);

			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('goodbye', tx);
			});
			expect(find.matchCount.get()).toBe(2);
			expect(controller.currentMatch.get(), 'currentMatch should be unset after a fresh search').toBe(undefined);

			// First replace() navigates to the first match without replacing.
			await controller.replace();
			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue(), 'First replace() should navigate, not replace').toBe('hello world hello');
			expect(controller.currentMatch.get(), 'currentMatch should be set after first replace()').toBeDefined();

			// Second replace() performs the replacement.
			await controller.replace();
			expect(cell.model.textModel!.getValue(), 'Second replace() should replace the first match').toBe('goodbye world hello');
		});
	});

	describe('Replace All', () => {

		it('replaceAll() replaces all matches in one operation', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('bye world bye');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(0);
		}));

		it('replaceAll() works across multiple cells', () => runWithFakedTimers({}, async () => {
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
			expect(cells[0].model.textModel!.getValue()).toBe('bye');
			expect(cells[1].model.textModel!.getValue()).toBe('world');
			expect(cells[2].model.textModel!.getValue()).toBe('bye again');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(0);
		}));

		it('replaceAll() applies all edits in a single IBulkEditService.apply call', async () => {
			const { controller, find } = findFixture([
				['aa', 'python', CellKind.Code],
				['aa', 'python', CellKind.Code],
			]);
			transaction((tx) => {
				find.searchString.set('aa', tx);
				find.replaceText.set('bb', tx);
			});

			await controller.replaceAll();

			expect(bulkEditApplySpy, 'apply should be called exactly once').toHaveBeenCalledOnce();
			const edits = bulkEditApplySpy.mock.calls[0][0];
			expect(edits.length, 'Should have two ResourceTextEdit objects').toBe(2);
			const options = bulkEditApplySpy.mock.calls[0][1];
			expect(options.quotableLabel).toBe('Notebook Replace All');
		});

		it('replaceAll() with zero matches is a no-op', async () => {
			const { notebook, controller, find } = findFixture([['hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('xyz', tx);
				find.replaceText.set('replaced', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('hello');
			expect(bulkEditApplySpy, 'IBulkEditService.apply should not be called').not.toHaveBeenCalled();
		});

		it('replaceAll() with regex capture groups builds per-match replacements', async () => {
			const { notebook, controller, find } = findFixture([['foo123 bar456', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('(\\w+?)(\\d+)', tx);
				find.replaceText.set('$2-$1', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('123-foo 456-bar');
		});

		// Undo grouping is verified by the "single IBulkEditService.apply call"
		// test above. The real BulkEditService uses pushEditOperations which
		// supports undo, so direct undo verification could be added if needed.
	});

	describe('Replace Edge Cases', () => {

		it('replace when match text equals replacement text still advances', async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('hello', tx);
			});

			controller.findNext(); // match 0
			await controller.replace();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('hello world hello');
			expect(bulkEditApplySpy, 'apply should still be called').toHaveBeenCalledOnce();

			// No debounce needed: replace() calls findNext() which sets
			// currentMatch synchronously. The text didn't change so
			// research() is a no-op.
			expect(controller.currentMatch.get()?.matchIndex).toBe(1);
		});

		it('replace with empty string deletes matched text', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello ', tx);
				find.replaceText.set('', tx);
			});

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('world');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(0);
		}));

		it('replaceAll with empty string deletes all matched text', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('', tx);
			});

			await controller.replaceAll();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe(' world ');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(0);
		}));

		it('replace triggers research and updates decorations', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});
			expect(find.matchCount.get()).toBe(2);

			controller.findNext();
			await controller.replace();

			await waitForDebounce();

			const cell = notebook.cells.get()[0];
			expect(getFindMatchDecorations(cell).length, 'One remaining match decoration').toBe(1);
		}));

		it('replaceAll clears all decorations', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('bye', tx);
			});

			await controller.replaceAll();

			await waitForDebounce();

			const cell = notebook.cells.get()[0];
			expect(getFindMatchDecorations(cell).length).toBe(0);
			expect(getCurrentFindMatchDecoration(cell)).toBe(undefined);
		}));

		it('replace on multi-line content', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['line1\nline2\nline1', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.searchString.set('line1', tx);
				find.replaceText.set('replaced', tx);
			});
			expect(find.matchCount.get()).toBe(2);

			controller.findNext();
			await controller.replace();

			const cell = notebook.cells.get()[0];
			expect(cell.model.textModel!.getValue()).toBe('replaced\nline2\nline1');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(1);
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
		it('replace() works when cursor is positioned after all matches in the cell', async () => {
			const { notebook, controller, find } = findFixture([['aa bb', 'python', CellKind.Code]]);
			const cell = notebook.cells.get()[0];

			// Place cursor at column 4 ('aa |bb') -- past the only 'aa' match at [1,1]-[1,3]
			cell.currentEditor!.setPosition({ lineNumber: 1, column: 4 });

			transaction((tx) => {
				find.searchString.set('aa', tx);
				find.replaceText.set('test', tx);
			});
			expect(find.matchCount.get()).toBe(1);

			// First replace() should navigate to the match (two-step behavior)
			await controller.replace();
			expect(cell.model.textModel!.getValue(), 'First replace() should navigate, not replace').toBe('aa bb');
			expect(controller.currentMatch.get(), 'currentMatch should be set after first replace()').toBeDefined();

			// Second replace() should perform the actual replacement
			await controller.replace();
			expect(cell.model.textModel!.getValue(), 'Second replace() should replace the match').toBe('test bb');
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
		it('replace() after debounce-triggered research immediately replaces next match', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([['hello world hello', 'python', CellKind.Code]]);
			const cell = notebook.cells.get()[0];

			transaction((tx) => {
				find.searchString.set('hello', tx);
				find.replaceText.set('hi', tx);
			});
			expect(find.matchCount.get()).toBe(2);

			// Navigate to match 0 (two-step behavior for fresh search)
			await controller.replace();
			expect(cell.model.textModel!.getValue(), 'First replace() should navigate, not replace').toBe('hello world hello');

			// Replace match 0
			await controller.replace();
			expect(cell.model.textModel!.getValue(), 'Second replace() should replace match 0').toBe('hi world hello');

			// Wait for debounced research to recompute matches.
			// The remaining 'hello' shifted from column 13 to column 10
			// due to the shorter replacement, so the old currentMatch is stale.
			await waitForDebounce();
			expect(find.matchCount.get()).toBe(1);

			// This replace() should immediately replace the remaining match
			// without requiring an extra navigation click
			await controller.replace();
			expect(cell.model.textModel!.getValue(), 'replace() after research should immediately replace, not just navigate').toBe('hi world hi');
		}));
	});

	describe('Performance Optimizations', () => {

		it('research() does not store capture groups (only needed for replace)', () => {
			const { controller, find } = findFixture([['foo123 bar456', 'python', CellKind.Code]]);
			transaction((tx) => {
				find.isRegex.set(true, tx);
				find.searchString.set('(\\w+?)(\\d+)', tx);
			});

			const matches = controller.matches.get();
			expect(matches.length).toBe(2);
			// research() should not pay the cost of capturing groups
			expect(matches[0].matches).toBe(null);
			expect(matches[1].matches).toBe(null);
		});

		it('replaceAll() replaces all matches beyond the decoration limit', () => runWithFakedTimers({}, async () => {
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
			expect(controller.matches.get().length, 'research() should limit matches to 999 for decorations').toBe(999);
			expect(getFindMatchDecorations(cell).length, 'decorations should be capped at 999').toBe(999);

			// replaceAll() should replace ALL 1100, not just the decorated 1000
			await controller.replaceAll();

			expect(cell.model.textModel!.getValue(), 'All 1100 matches should be replaced, not just the first 1000').not.toContain('aa');

			await waitForDebounce();
			expect(find.matchCount.get()).toBe(0);
		}));
	});

	describe('Undo', () => {

		it('undoes a single replace, reverting the cell content', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			]);
			transaction((tx) => {
				find.searchString.set('Cell', tx);
				find.replaceText.set('Replaced', tx);
			});

			controller.findNext();
			await controller.replace();

			const cells = notebook.cells.get();
			expect(cells[0].model.textModel!.getValue()).toBe('# Replaced 0');

			cells[0].model.textModel!.undo();
			expect(cells[0].model.textModel!.getValue()).toBe('# Cell 0');
		}));

		it('undoes replaceAll, reverting all changed cells', () => runWithFakedTimers({}, async () => {
			const { notebook, controller, find } = findFixture([
				['# Cell 0', 'python', CellKind.Code],
				['# Cell 1', 'python', CellKind.Code],
				['# Cell 2', 'python', CellKind.Code],
			]);
			transaction((tx) => {
				find.searchString.set('Cell', tx);
				find.replaceText.set('New', tx);
			});

			await controller.replaceAll();

			const cells = notebook.cells.get();
			expect(cells[0].model.textModel!.getValue()).toBe('# New 0');
			expect(cells[1].model.textModel!.getValue()).toBe('# New 1');
			expect(cells[2].model.textModel!.getValue()).toBe('# New 2');

			// Production BulkEditService groups edits across resources so a
			// single editor undo reverts the whole group; TestBulkEditService
			// applies edits per-model, so we undo each model independently.
			// What this test asserts is that every cell's replace IS undoable
			// (the find controller passed edits through pushEditOperations,
			// not destructive applyEdits).
			cells[0].model.textModel!.undo();
			cells[1].model.textModel!.undo();
			cells[2].model.textModel!.undo();

			expect(cells[0].model.textModel!.getValue()).toBe('# Cell 0');
			expect(cells[1].model.textModel!.getValue()).toBe('# Cell 1');
			expect(cells[2].model.textModel!.getValue()).toBe('# Cell 2');
		}));

	});

});
