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
import { FindMatch, IModelDeltaDecoration } from '../../../../../../editor/common/model.js';
import { autorun, IObservable, observableValue, runOnChange, transaction } from '../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { getActiveCell } from '../../selectionMachine.js';
import { NextMatchFindAction, PreviousMatchFindAction, StartFindAction } from '../../../../../../editor/contrib/find/browser/findController.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { FindDecorations } from '../../../../../../editor/contrib/find/browser/findDecorations.js';
import { PositronFindInstance } from './PositronFindInstance.js';
import { IPosition, Position } from '../../../../../../editor/common/core/position.js';
import { IRange, Range } from '../../../../../../editor/common/core/range.js';

/** A position in a cell editor. */
interface ICellEditorPosition {
	cellIndex: number;
	position: IPosition;
}

/** A range in a cell editor. */
interface ICellEditorRange {
	cellIndex: number;
	range: IRange;
}

interface ICellFindMatch {
	cellRange: ICellEditorRange;
	matches: string[] | null;
}

interface IPositronCellFindMatch extends ICellFindMatch {
	cell: IPositronNotebookCell;
}

class CellEditorPosition implements ICellEditorPosition {
	constructor(
		public readonly cellIndex: number,
		public readonly position: IPosition,
	) { }

	isBefore(other: ICellEditorPosition): boolean {
		return CellEditorPosition.isBefore(this, other);
	}

	public static isBefore(a: ICellEditorPosition, b: ICellEditorPosition): boolean {
		if (a.cellIndex < b.cellIndex) {
			return true;
		}
		if (a.cellIndex > b.cellIndex) {
			return false;
		}
		return Position.isBefore(a.position, b.position);
	}

	isBeforeOrEqual(other: ICellEditorPosition): boolean {
		return CellEditorPosition.isBeforeOrEqual(this, other);
	}

	public static isBeforeOrEqual(a: ICellEditorPosition, b: ICellEditorPosition): boolean {
		if (a.cellIndex < b.cellIndex) {
			return true;
		}
		if (a.cellIndex > b.cellIndex) {
			return false;
		}
		if (Position.isBeforeOrEqual(a.position, b.position)) {
			return true;
		}
		return false;
	}


}

class CellEditorRange implements ICellEditorRange {
	constructor(
		public readonly cellIndex: number,
		public readonly range: Range,
	) { }

	containsPosition(cellPosition: ICellEditorPosition): boolean {
		return CellEditorRange.containsPosition(this, cellPosition);
	}

	public static containsPosition(cellRange: ICellEditorRange, cellPosition: ICellEditorPosition): boolean {
		return cellRange.cellIndex === cellPosition.cellIndex && Range.containsPosition(cellRange.range, cellPosition.position);
	}

	getStartPosition(): CellEditorPosition {
		return CellEditorRange.getStartPosition(this);
	}

	public static getStartPosition(range: ICellEditorRange): CellEditorPosition {
		return new CellEditorPosition(range.cellIndex, Range.getStartPosition(range.range));
	}

	getEndPosition(): CellEditorPosition {
		return CellEditorRange.getEndPosition(this);
	}

	public static getEndPosition(range: ICellEditorRange): CellEditorPosition {
		return new CellEditorPosition(range.cellIndex, Range.getEndPosition(range.range));
	}
}

class PositronCellFindMatch implements IPositronCellFindMatch {
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

		this._register(new CellFindDecorations(
			this._notebook,
			this._matches,
			this._currentMatch,
		));
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
			const instance = this._register(new PositronFindInstance({
				container: this._notebook.container,
				findInputOptions: {
					label: localize('positronNotebook.find.label', "Find"),
					placeholder: localize('positronNotebook.find.placeholder', "Find"),
					showCommonFindToggles: true,
					inputBoxStyles: defaultInputBoxStyles,
					toggleStyles: defaultToggleStyles,
				},
			}));
			this._findInstance = instance;

			// Subscribe to user action events
			this._register(instance.onDidRequestFindNext(() => this.findNext()));
			this._register(instance.onDidRequestFindPrevious(() => this.findPrevious()));

			// Subscribe to visibility changes
			this._register(runOnChange(instance.isVisible, (visible) => {
				if (visible) {
					findWidgetVisible.set(true);
				} else {
					// Reset context keys
					findWidgetVisible.reset();
					findInputFocused.reset();

					// Clear state
					transaction((tx) => {
						// TODO: Should we clear state, or restore on reshow?
						this._matches.set([], tx);
						this._currentMatch.set(undefined, tx);
					});
				}
			}));

			// Subscribe to focus changes
			this._register(runOnChange(instance.inputFocused, (focused) => {
				if (focused) {
					findInputFocused.set(true);
				} else {
					findInputFocused.reset();
				}
			}));

			// Subscribe to search parameter changes
			this._register(autorun(reader => {
				const searchString = instance.searchString.read(reader);
				const isRegex = instance.isRegex.read(reader);
				const matchCase = instance.matchCase.read(reader);
				const wholeWord = instance.wholeWord.read(reader);

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
					instance.matchCount.set(cellMatches.length, tx);
					instance.matchIndex.set(matchIndex, tx);
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

		let cellMatchIndex = 0;
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

				cellMatchIndex++;
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

		// Clear previous current match decoration if it was in a different cell
		// const currentMatchIndex = this._currentMatchIndex.get();
		// if (currentMatchIndex !== undefined) {
		// 	const prevMatch = cellMatches[currentMatchIndex];
		// 	if (prevMatch && prevMatch.cell.handle !== cellMatch.cell.handle) {
		// 		this.updateCellDecorations(prevMatch.cell);
		// 	}
		// }

		// Update current match tracking
		this._currentMatch.set({ cellMatch, index: matchIndex }, undefined);

		// Update decorations to highlight the current match
		// this.updateCellDecorations(cell);

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

		// Update the match index
		const findInstance = this.getOrCreateFindInstance();
		findInstance.matchIndex.set(matchIndex, undefined);
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

	// TODO: Seed the search with the cursor word or selection
	controller.start();
	return true;
});

class CellFindDecorations extends Disposable {
	private readonly _decorationIdsByCellHandle = new Map<number, string[]>();
	private _currentMatchDecorationId: { cell: IPositronNotebookCell; decorationId: string } | undefined;

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		private readonly _matches: IObservable<IPositronCellFindMatch[]>,
		private readonly _currentMatch: IObservable<{ cellMatch: PositronCellFindMatch; index: number } | undefined>,
	) {
		super();

		this._register(autorun(reader => {
			const allMatches = this._matches.read(reader);

			// Group matches by cell
			const cellMatchesByCell = new Map<IPositronNotebookCell, IPositronCellFindMatch[]>();
			for (const cellMatch of allMatches) {
				let cellMatches = cellMatchesByCell.get(cellMatch.cell);
				if (!cellMatches) {
					cellMatches = [];
					cellMatchesByCell.set(cellMatch.cell, cellMatches);
				}
				cellMatches.push(cellMatch);
			}

			// Update all cell editor decorations
			for (const [cell, cellMatches] of cellMatchesByCell.entries()) {
				if (!cell.editor) {
					continue;
				}

				const newDecorations: IModelDeltaDecoration[] = cellMatches.map(cellMatch => ({
					range: cellMatch.cellRange.range,
					options: FindDecorations._FIND_MATCH_DECORATION,
				}));

				cell.editor.changeDecorations(accessor => {
					const oldDecorationIds = this._decorationIdsByCellHandle.get(cell.handle) || [];
					const newDecorationIds = accessor.deltaDecorations(oldDecorationIds, newDecorations);
					this._decorationIdsByCellHandle.set(cell.handle, newDecorationIds);
				});
			}
		}));

		this._register(autorun(reader => {
			const currentMatch = this._currentMatch.read(reader);

			// Reset the existing current match decoration, if one exists
			const oldDecoration = this._currentMatchDecorationId;
			if (oldDecoration) {
				const { cell, decorationId } = oldDecoration;
				if (cell.editor) {
					cell.editor.changeDecorations(accessor => {
						accessor.changeDecorationOptions(decorationId, FindDecorations._FIND_MATCH_DECORATION);
					});
				}
				this._currentMatchDecorationId = undefined;
			}

			// Add the new current match decoration
			if (currentMatch) {
				const { cell, cellRange } = currentMatch.cellMatch;
				if (!cell.editor) {
					return;
				}

				let newCurrentDecorationId: string | null = null;
				if (cellRange.range) {
					const decorationIds = this._decorationIdsByCellHandle.get(cell.handle) ?? [];
					for (const decorationId of decorationIds) {
						const model = cell.editor.getModel();
						if (model) {
							const range = model.getDecorationRange(decorationId);
							if (cellRange.range.equalsRange(range)) {
								newCurrentDecorationId = decorationId;
								break;
							}
						}
					}
				}

				if (newCurrentDecorationId !== null) {
					cell.editor.changeDecorations(accessor => {
						accessor.changeDecorationOptions(newCurrentDecorationId, FindDecorations._CURRENT_FIND_MATCH_DECORATION);
					});

					this._currentMatchDecorationId = { cell, decorationId: newCurrentDecorationId };
				}
			}
		}));
	}

	clear() {
		for (const cell of this._notebook.cells.get()) {
			if (cell.editor) {
				const oldDecorationIds = this._decorationIdsByCellHandle.get(cell.handle);
				if (oldDecorationIds) {
					cell.editor.changeDecorations(accessor => {
						accessor.deltaDecorations(oldDecorationIds, []);
					});
				}
			}
		}
	}
}
