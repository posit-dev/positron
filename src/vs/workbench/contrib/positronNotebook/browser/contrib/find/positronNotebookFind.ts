/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { EditorContextKeys } from '../../../../../../editor/common/editorContextKeys.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize, localize2 } from '../../../../../../nls.js';
import { registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../ContextKeysManager.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { IPositronNotebookContribution, registerPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { FindMatch } from '../../../../../../editor/common/model.js';
import { autorun, observableValue, runOnChange, transaction } from '../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { getActiveCell } from '../../selectionMachine.js';
import { NextMatchFindAction, PreviousMatchFindAction, StartFindAction } from '../../../../../../editor/contrib/find/browser/findController.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { PositronFindInstance } from './PositronFindInstance.js';
import { PositronNotebookFindDecorations } from './PositronNotebookFindDecorations.js';
import { CellEditorPosition } from '../../../common/editor/position.js';
import { CellEditorRange, ICellEditorRange } from '../../../common/editor/range.js';

export interface ICellFindMatch {
	cellRange: ICellEditorRange;
	matches: string[] | null;
}

export interface IPositronCellFindMatch extends ICellFindMatch {
	cell: IPositronNotebookCell;
}

export class PositronCellFindMatch implements IPositronCellFindMatch {
	constructor(
		public readonly cell: IPositronNotebookCell,
		public readonly cellRange: CellEditorRange,
		public readonly matches: string[] | null,
	) { }

	// TODO: need this?
	public static fromFindMatch(cell: IPositronNotebookCell, cellIndex: number, match: FindMatch): PositronCellFindMatch {
		return new PositronCellFindMatch(cell, new CellEditorRange(cellIndex, match.range), match.matches);
	}
}

// interface CellMatchIndex {
// 	cellMatchIndex: number;
// 	findMatchIndex: number;
// }

// class CellMatchList {
// 	constructor(
// 		private _cellMatches: CellMatch[] = [],
// 	) { }

// 	get length(): number {
// 		return this._cellMatches.reduce((length, cellMatch) => length + cellMatch.matches.length, 0);
// 	}

// 	*entries(): IterableIterator<[CellMatchIndex, FindMatch]> {
// 		for (const [cellMatchIndex, cellMatch] of this._cellMatches.entries()) {
// 			for (const [findMatchIndex, match] of cellMatch.matches.entries()) {
// 				yield [{ cellMatchIndex, findMatchIndex }, match];
// 			}
// 		}
// 	}

// 	at(index: CellMatchIndex): FindMatch | undefined {
// 		for (const [matchIndex, match] of this.entries()) {
// 			if (index === matchIndex) {
// 				return match;
// 			}
// 		}
// 		return undefined;
// 	}

// 	clear(): void {
// 		this._cellMatches = [];
// 	}

// 	push(match: CellMatch): void {
// 		this._cellMatches.push(match);
// 	}
// }

/** TODO: Note that this is tied to one notebook instance lifecycle */
export class PositronNotebookFindController extends Disposable implements IPositronNotebookContribution {
	public static readonly ID = 'positron.notebook.contrib.findController';

	private _findInstance: PositronFindInstance | undefined;
	// TODO: Note ordering
	private readonly _matches = observableValue<PositronCellFindMatch[]>('positronNotebookFindControllerMatches', []);
	private readonly _currentMatch = observableValue<{ cellMatch: PositronCellFindMatch; index: number } | undefined>('positronNotebookFindControllerCurrentMatchIndex', undefined);

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		this._register(new PositronNotebookFindDecorations(this._matches, this._currentMatch));
	}

	public static get(notebook: IPositronNotebookInstance): PositronNotebookFindController | undefined {
		return notebook.getContribution<PositronNotebookFindController>(PositronNotebookFindController.ID);
	}

	/**
	 * Gets the find instance, creating it if necessary.
	 */
	private getOrCreateFindInstance(): PositronFindInstance {
		if (!this._findInstance) {
			// TODO: How to handle this state? Wait until container and scoped context key service are available?
			if (!this._notebook.container) {
				throw new Error('Notebook container not available for Find Widget rendering');
			}
			if (!this._notebook.scopedContextKeyService) {
				throw new Error('Scoped context key service not available for Find Widget');
			}

			// Bind context keys
			const findWidgetVisible = CONTEXT_FIND_WIDGET_VISIBLE.bindTo(this._notebook.scopedContextKeyService);
			const findInputFocused = CONTEXT_FIND_INPUT_FOCUSED.bindTo(this._notebook.scopedContextKeyService);

			// Create the find instance
			const findInstance = this._register(new PositronFindInstance({
				container: this._notebook.container,
				findInputOptions: {
					label: localize('positronNotebook.find.label', "Find"),
					placeholder: localize('positronNotebook.find.placeholder', "Find"),
					showCommonFindToggles: true,
					inputBoxStyles: defaultInputBoxStyles,
					toggleStyles: defaultToggleStyles,
				},
			}));
			this._findInstance = findInstance;

			// Subscribe to user action events
			this._register(findInstance.onDidRequestFindNext(() => this.findNext()));
			this._register(findInstance.onDidRequestFindPrevious(() => this.findPrevious()));

			// Subscribe to visibility changes
			this._register(runOnChange(findInstance.isVisible, (visible) => {
				if (visible) {
					findWidgetVisible.set(true);
				} else {
					// Reset context keys
					findWidgetVisible.reset();
					findInputFocused.reset();

					// Clear state
					transaction((tx) => {
						this._matches.set([], tx);
						this._currentMatch.set(undefined, tx);
					});
				}
			}));

			// Subscribe to focus changes
			this._register(runOnChange(findInstance.inputFocused, (focused) => {
				if (focused) {
					findInputFocused.set(true);
				} else {
					findInputFocused.reset();
				}
			}));

			// Subscribe to search parameter changes
			this._register(autorun(reader => {
				const searchString = findInstance.searchString.read(reader);
				const isRegex = findInstance.isRegex.read(reader);
				const matchCase = findInstance.matchCase.read(reader);
				const wholeWord = findInstance.wholeWord.read(reader);

				console.info('PositronNotebookFindController: Starting research with', { searchString, isRegex, matchCase, wholeWord });
				const cellMatches = this.research(searchString, isRegex, matchCase, wholeWord);

				// TODO: if there's no current match, find the closest one.
				// TODO: OR always determine the current match from the cursor?
				//       Just move the cursor when navigating to previous/next?
				//       This should handle match count changing, cursor changing, etc.
				const cursorPosition = this.getCursorPosition();

				// TODO: Extract method?
				// Determine the current match index based on cursor position
				let matchIndex: number | undefined = undefined;
				if (cursorPosition && cellMatches.length > 0) {
					const foundIndex = cellMatches.findLastIndex(({ cellRange }) =>
						cellRange.containsPosition(cursorPosition) ||
						cellRange.getEndPosition().isBefore(cursorPosition)
					);
					matchIndex = foundIndex !== -1 ? foundIndex : undefined;
				}

				// Update matches, match count and index
				transaction((tx) => {
					this._matches.set(cellMatches, tx);
					findInstance.matchCount.set(cellMatches.length, tx);
					findInstance.matchIndex.set(matchIndex, tx);
				});
			}));
		}

		return this._findInstance;
	}

	/**
	 * Shows the find widget and starts the find operation.
	 */
	public start(): void {
		const findInstance = this.getOrCreateFindInstance();
		findInstance.show();
	}

	/**
	 * Closes the find widget.
	 * This is called by actions.
	 */
	public closeWidget(): void {
		if (this._findInstance) {
			this._findInstance.hide();
		}
	}

	/**
	 * Performs a search across all notebook cells.
	 */
	private research(searchString: string, isRegex: boolean, matchCase: boolean, wholeWord: boolean): PositronCellFindMatch[] {
		const cellMatches: PositronCellFindMatch[] = [];
		// TODO: what to do with current match on research?
		// this._currentMatchIndex = undefined;
		for (const [cellIndex, cell] of this._notebook.cells.get().entries()) {
			if (cell.model.textModel) {
				const wordSeparators = this._configurationService.inspect<string>('editor.wordSeparators').value;
				const matches = cell.model.textModel.findMatches(
					searchString,
					null,
					isRegex,
					matchCase,
					wholeWord ? wordSeparators || null : null,
					isRegex,
				);

				// Store each match with its cell reference and index
				for (const match of matches) {
					const cellMatch = PositronCellFindMatch.fromFindMatch(cell, cellIndex, match);
					cellMatches.push(cellMatch);
				}
			}
		}
		return cellMatches;
	}

	public findNext(): void {
		// Find the next match from the current cursor position
		const nextMatchIndex = this.findNextMatchFromCursor();
		if (nextMatchIndex !== -1) {
			this.navigateToMatch(nextMatchIndex);
		}
	}

	public findPrevious(): void {
		// Find the previous match from the current cursor position
		const prevMatchIndex = this.findPreviousMatchFromCursor();
		if (prevMatchIndex !== -1) {
			this.navigateToMatch(prevMatchIndex);
		}
	}

	private findNextMatchFromCursor(): number {
		const cellMatches = this._matches.get();

		// No matches
		if (cellMatches.length === 0) {
			// TODO: What if there's a current match?...
			return -1;
		}

		const currentMatch = this._currentMatch.get();

		// Current match known
		if (currentMatch !== undefined) {
			// Go to the next match, wrapping around if needed
			const nextIndex = currentMatch.index + 1;
			return nextIndex < cellMatches.length ? nextIndex : 0;
		}

		// If we don't have a current match yet, find first match after cursor
		const cursorPosition = this.getCursorPosition();
		if (!cursorPosition) {
			// TODO: When does this happen? Should we jump to the next cell?
			return -1;
		}

		// Find the first match after the cursor
		const matchIndex = cellMatches.findIndex(({ cellRange }) =>
			cellRange.containsPosition(cursorPosition) ||
			cursorPosition.isBefore(cellRange.getStartPosition())
		);

		// TODO: How to handle this?
		if (matchIndex === -1) {
			return -1;
		}

		return matchIndex;
	}

	private findPreviousMatchFromCursor(): number {
		const cellMatches = this._matches.get();

		// No matches
		if (cellMatches.length === 0) {
			// TODO: What if there's a current match?...
			return -1;
		}

		const currentMatch = this._currentMatch.get();

		// Current match known
		if (currentMatch !== undefined) {
			// Go to the previous match, wrapping around if needed
			const prevIndex = currentMatch.index - 1;
			return prevIndex >= 0 ? prevIndex : cellMatches.length - 1;
		}

		// If we don't have a current match yet, find last match before cursor
		const cursorPosition = this.getCursorPosition();
		if (!cursorPosition) {
			// TODO: When does this happen? Should we jump to the next cell?
			return -1;
		}

		// Find the last match before the cursor
		const matchIndex = cellMatches.findLastIndex(({ cellRange }) =>
			cellRange.containsPosition(cursorPosition) ||
			cellRange.getEndPosition().isBefore(cursorPosition)
		);

		// TODO: How to handle this?
		if (matchIndex === -1) {
			return -1;
		}

		return matchIndex;
	}

	// TODO: Move to IPositronNotebookInstance?
	private getCursorPosition(): CellEditorPosition | undefined {
		// Get the currently active cell and cursor position

		// No current match tracked, use cursor position
		// Find the currently active cell
		const selectionState = this._notebook.selectionStateMachine.state.get();
		const activeCell = getActiveCell(selectionState);
		if (!activeCell) {
			// TODO: Should this be an error?
			return undefined;
		}

		const position = activeCell.editor?.getPosition();
		if (!position) {
			return undefined;
		}

		return new CellEditorPosition(
			activeCell.index,
			position,
		);
	}

	private navigateToMatch(matchIndex: number): void {
		const cellMatches = this._matches.get();

		if (matchIndex < 0 || matchIndex >= cellMatches.length) {
			return;
		}

		const cellMatch = cellMatches[matchIndex];
		const { cell } = cellMatch;

		// Select the cell
		this._notebook.selectionStateMachine.selectCell(cell);

		// Select the match in the editor
		// TODO: Move this to IPositronNotebookInstance?
		if (cell.editor) {
			// Set the selection to the match range
			cell.editor.setSelection(cellMatch.cellRange.range);
			// Reveal the range in the editor
			cell.editor.revealRangeInCenter(cellMatch.cellRange.range);
		}

		const findInstance = this.getOrCreateFindInstance();

		transaction((tx) => {
			// Update the match index
			findInstance.matchIndex.set(matchIndex, tx);

			// Update current match tracking
			this._currentMatch.set({ cellMatch, index: matchIndex }, tx);
		});
	}
}

registerPositronNotebookContribution(PositronNotebookFindController.ID, PositronNotebookFindController);

abstract class PositronNotebookFindAction extends NotebookAction2 {
	override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): Promise<void> {
		const controller = PositronNotebookFindController.get(notebook);
		if (controller) {
			await this.runFindAction(controller);
		}
	}

	abstract runFindAction(controller: PositronNotebookFindController): Promise<void>;
}

registerAction2(class extends PositronNotebookFindAction {
	constructor() {
		super({
			id: 'positron.notebook.find',
			title: localize2('positron.notebook.find.title', 'Find in Notebook'),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					// ContextKeyExpr.or(NOTEBOOK_IS_ACTIVE_EDITOR, INTERACTIVE_WINDOW_IS_ACTIVE_EDITOR),
					EditorContextKeys.focus.toNegated()
				),
				primary: KeyCode.KeyF | KeyMod.CtrlCmd,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
		controller.start();
	}
});

registerAction2(class extends PositronNotebookFindAction {
	constructor() {
		super({
			id: 'positron.notebook.hideFind',
			title: localize2('positron.notebook.hideFind.title', 'Hide Find in Notebook'),
			keybinding: {
				when: ContextKeyExpr.and(
					POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
					CONTEXT_FIND_WIDGET_VISIBLE,
				),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib + 5
			}
		});
	}

	override async runFindAction(controller: PositronNotebookFindController): Promise<void> {
		controller.closeWidget();
	}
});

NextMatchFindAction.addImplementation(0, (accessor: ServicesAccessor, _codeEditor: ICodeEditor, _args: unknown) => {
	const editorService = accessor.get(IEditorService);
	const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!notebook) {
		return false;
	}

	const controller = PositronNotebookFindController.get(notebook);
	if (!controller) {
		return false;
	}

	controller.findNext();
	return true;
});

PreviousMatchFindAction.addImplementation(0, (accessor: ServicesAccessor, _codeEditor: ICodeEditor, _args: unknown) => {
	const editorService = accessor.get(IEditorService);
	const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!notebook) {
		return false;
	}

	const controller = PositronNotebookFindController.get(notebook);
	if (!controller) {
		return false;
	}

	controller.findPrevious();
	return true;
});

// Invoked when Cmd+F is pressed while editing a notebook cell
StartFindAction.addImplementation(100, (accessor: ServicesAccessor, _codeEditor: ICodeEditor, _args: unknown) => {
	const editorService = accessor.get(IEditorService);
	const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!notebook) {
		return false;
	}

	const controller = PositronNotebookFindController.get(notebook);
	if (!controller) {
		return false;
	}

	controller.start();
	return true;
});
