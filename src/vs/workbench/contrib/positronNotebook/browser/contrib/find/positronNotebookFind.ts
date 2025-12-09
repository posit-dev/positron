/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { EditorContextKeys } from '../../../../../../editor/common/editorContextKeys.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize2 } from '../../../../../../nls.js';
import { registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../ContextKeysManager.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { NotebookAction2 } from '../../NotebookAction2.js';
import { IPositronNotebookContribution, registerPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { FindMatch, IModelDeltaDecoration } from '../../../../../../editor/common/model.js';
import { autorun, runOnChange, transaction } from '../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { Toggle } from '../../../../../../base/browser/ui/toggle/toggle.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { getActiveCell } from '../../selectionMachine.js';
import { NextMatchFindAction, PreviousMatchFindAction, StartFindAction } from '../../../../../../editor/contrib/find/browser/findController.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { FindDecorations } from '../../../../../../editor/contrib/find/browser/findDecorations.js';
import { PositronFindInstance } from './PositronFindInstance.js';

interface CellMatch {
	cell: IPositronNotebookCell;
	cellIndex: number;
	match: FindMatch;
}

/** TODO: Note that this is tied to one notebook instance lifecycle */
export class PositronNotebookFindController extends Disposable implements IPositronNotebookContribution {
	public static readonly ID = 'positron.notebook.contrib.findController';

	private _findInstance: PositronFindInstance | undefined;
	private readonly _decorationIdsByCellHandle = new Map<number, string[]>();
	private _allMatches: CellMatch[] = [];
	private _currentMatchCellHandle: number | undefined;
	private _currentMatchIndex: number | undefined;

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	public static get(notebook: IPositronNotebookInstance): PositronNotebookFindController | undefined {
		return notebook.getContribution<PositronNotebookFindController>(PositronNotebookFindController.ID);
	}

	/**
	 * Gets the find instance, creating it if necessary.
	 */
	private getOrCreateFindInstance(): PositronFindInstance {
		if (!this._findInstance) {
			if (!this._notebook.container) {
				throw new Error('Notebook container not available for Find Widget rendering');
			}
			if (!this._notebook.scopedContextKeyService) {
				throw new Error('Scoped context key service not available for Find Widget');
			}

			// Bind context keys
			const findWidgetVisible = CONTEXT_FIND_WIDGET_VISIBLE.bindTo(this._notebook.scopedContextKeyService);
			const findInputFocused = CONTEXT_FIND_INPUT_FOCUSED.bindTo(this._notebook.scopedContextKeyService);

			// Create find in selection toggle for notebook-specific functionality
			const findInSelectionToggle = new Toggle({
				icon: Codicon.selection,
				title: 'Find in Selection',
				isChecked: false,
				...defaultToggleStyles,
			});

			this._register(findInSelectionToggle.onChange(() => {
				// TODO: Implement find in selection logic for notebooks
				console.log('Find in selection toggled');
			}));

			// Create the find instance
			const instance = this._register(new PositronFindInstance({
				container: this._notebook.container,
				findInputOptions: {
					label: 'Find',
					placeholder: 'Find',
					showCommonFindToggles: true,
					inputBoxStyles: defaultInputBoxStyles,
					toggleStyles: defaultToggleStyles,
					additionalToggles: [findInSelectionToggle],
				},
			}));

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

					// Clear decorations
					for (const cell of this._notebook.cells.get()) {
						const oldDecorationIds = this._decorationIdsByCellHandle.get(cell.handle) || [];
						cell.editor?.changeDecorations(accessor => {
							accessor.deltaDecorations(oldDecorationIds, []);
						});
					}

					// TODO: Should we clear state, or restore on reshow?
					// Clear state
					this._decorationIdsByCellHandle.clear();
					this._allMatches = [];
					this._currentMatchCellHandle = undefined;
					this._currentMatchIndex = undefined;
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

				this.research(searchString, isRegex, matchCase, wholeWord);
			}));

			this._findInstance = instance;
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
	private research(searchString: string, isRegex: boolean, matchCase: boolean, wholeWord: boolean): void {
		const findInstance = this.getOrCreateFindInstance();
		this._allMatches = [];
		this._currentMatchCellHandle = undefined;
		this._currentMatchIndex = undefined;
		let totalMatchCount = 0;

		for (const cell of this._notebook.cells.get()) {
			if (cell.model.textModel) {
				const wordSeparators = this._configurationService.inspect<string>('editor.wordSeparators').value;
				const cellMatches = cell.model.textModel.findMatches(
					searchString,
					null,
					isRegex,
					matchCase,
					wholeWord ? wordSeparators || null : null,
					isRegex,
				);

				// Store each match with its cell reference and index
				const cellIndex = cell.index;
				for (const match of cellMatches) {
					this._allMatches.push({ cell, cellIndex, match });
				}
				totalMatchCount += cellMatches.length;
				// TODO: Fall back to text buffer if no text model?

				// Update decorations for this cell
				this.updateCellDecorations(cell);

				// filter based on options and editing state
				// return matches.filter(match => {
				// 	if (match.cell.cellKind === CellKind.Code) {
				// 		// code cell, we only include its match if include input is enabled
				// 		return options.includeCodeInput;
				// 	}

				// 	// markup cell, it depends on the editing state
				// 	if (match.cell.getEditState() === CellEditState.Editing) {
				// 		// editing, even if we includeMarkupPreview
				// 		return options.includeMarkupInput;
				// 	} else {
				// 		// cell in preview mode, we should only include it if includeMarkupPreview is false but includeMarkupInput is true
				// 		// if includeMarkupPreview is true, then we should include the webview match result other than this
				// 		return !options.includeMarkupPreview && options.includeMarkupInput;
				// 	}
				// }
				// );
			}
		}

		// Update match count and index
		transaction((tx) => {
			findInstance.matchCount.set(totalMatchCount, tx);
			findInstance.matchIndex.set(totalMatchCount > 0 ? 1 : undefined, tx);
		});
	}

	public findNext(): void {
		if (this._allMatches.length === 0) {
			return;
		}

		// Find the next match from the current cursor position
		const nextMatchIndex = this.findNextMatchFromCursor();
		if (nextMatchIndex !== -1) {
			this.navigateToMatch(nextMatchIndex);
		}
	}

	public findPrevious(): void {
		if (this._allMatches.length === 0) {
			return;
		}

		// Find the previous match from the current cursor position
		const prevMatchIndex = this.findPreviousMatchFromCursor();
		if (prevMatchIndex !== -1) {
			this.navigateToMatch(prevMatchIndex);
		}
	}

	private findNextMatchFromCursor(): number {
		// If we have a current match, just go to the next one
		if (this._currentMatchIndex !== undefined) {
			const nextIndex = this._currentMatchIndex + 1;
			if (nextIndex < this._allMatches.length) {
				return nextIndex + 1; // Convert to 1-based
			}
			// Wrap around to first
			return 1;
		}

		// No current match tracked, use cursor position
		const selectionState = this._notebook.selectionStateMachine.state.get();
		const activeCell = getActiveCell(selectionState);

		// Get the currently active cell and cursor position
		let currentCellIndex = -1;
		let currentPosition: Position | null = null;

		// Find the currently active cell
		if (activeCell) {
			currentCellIndex = activeCell.index;
			if (activeCell.editor) {
				currentPosition = activeCell.editor.getPosition();
			}
		}

		// If no cell is active, start from the first match
		if (currentCellIndex === -1) {
			return 1;
		}

		// Find the next match after the current position
		for (let i = 0; i < this._allMatches.length; i++) {
			const { cellIndex: matchCellIndex, match } = this._allMatches[i];

			// If match is in a later cell, it's the next match
			if (matchCellIndex > currentCellIndex) {
				return i + 1;
			}

			// If match is in the same cell, check if it's after the cursor
			if (matchCellIndex === currentCellIndex && currentPosition) {
				if (match.range.startLineNumber > currentPosition.lineNumber ||
					(match.range.startLineNumber === currentPosition.lineNumber && match.range.startColumn > currentPosition.column)) {
					return i + 1;
				}
			}
		}

		// Wrap around to the first match
		return 1;
	}

	private findPreviousMatchFromCursor(): number {
		// If we have a current match, just go to the previous one
		if (this._currentMatchIndex !== undefined) {
			const prevIndex = this._currentMatchIndex - 1;
			if (prevIndex >= 0) {
				return prevIndex + 1; // Convert to 1-based
			}
			// Wrap around to last
			return this._allMatches.length;
		}

		// No current match tracked, use cursor position
		const selectionState = this._notebook.selectionStateMachine.state.get();
		const activeCell = getActiveCell(selectionState);

		// Get the currently active cell and cursor position
		let currentCellIndex = -1;
		let currentPosition: Position | null = null;

		// Find the currently active cell
		if (activeCell) {
			currentCellIndex = activeCell.index;
			if (activeCell.editor) {
				currentPosition = activeCell.editor.getPosition();
			}
		}

		// If no cell is active, start from the last match
		if (currentCellIndex === -1) {
			return this._allMatches.length;
		}

		// Find the previous match before the current position (search backwards)
		for (let i = this._allMatches.length - 1; i >= 0; i--) {
			const { cellIndex: matchCellIndex, match } = this._allMatches[i];

			// If match is in an earlier cell, it's the previous match
			if (matchCellIndex < currentCellIndex) {
				return i + 1;
			}

			// If match is in the same cell, check if it's before the cursor
			if (matchCellIndex === currentCellIndex && currentPosition) {
				if (match.range.startLineNumber < currentPosition.lineNumber ||
					(match.range.startLineNumber === currentPosition.lineNumber && match.range.startColumn < currentPosition.column)) {
					return i + 1;
				}
			}
		}

		// Wrap around to the last match
		return this._allMatches.length;
	}

	private updateCellDecorations(cell: IPositronNotebookCell): void {
		// Get all matches for this cell
		const cellMatches = this._allMatches
			.filter(m => m.cell.handle === cell.handle)
			.map((m) => {
				const globalIndex = this._allMatches.indexOf(m);
				return { match: m.match, globalIndex };
			});

		const newDecorations: IModelDeltaDecoration[] = [];
		for (const { match, globalIndex } of cellMatches) {
			// Use current match decoration if this is the current match
			const isCurrentMatch = globalIndex === this._currentMatchIndex;
			newDecorations.push({
				range: match.range,
				options: isCurrentMatch
					? FindDecorations._CURRENT_FIND_MATCH_DECORATION
					: FindDecorations._FIND_MATCH_DECORATION
			});
		}

		const oldDecorationIds = this._decorationIdsByCellHandle.get(cell.handle) || [];
		cell.editor?.changeDecorations(accessor => {
			const newDecorationIds = accessor.deltaDecorations(oldDecorationIds, newDecorations);
			this._decorationIdsByCellHandle.set(cell.handle, newDecorationIds);
		});
	}

	private navigateToMatch(matchIndex: number): void {
		if (matchIndex < 1 || matchIndex > this._allMatches.length) {
			return;
		}

		const { cell, match } = this._allMatches[matchIndex - 1]; // Convert to 0-based index

		// Clear previous current match decoration
		if (this._currentMatchCellHandle !== undefined && this._currentMatchIndex !== undefined) {
			const prevCell = this._notebook.cells.get().find(c => c.handle === this._currentMatchCellHandle);
			if (prevCell) {
				this.updateCellDecorations(prevCell);
			}
		}

		// Update current match tracking
		this._currentMatchCellHandle = cell.handle;
		this._currentMatchIndex = matchIndex - 1;

		// Update decorations to highlight the current match
		this.updateCellDecorations(cell);

		// Select the cell
		this._notebook.selectionStateMachine.selectCell(cell);

		// Select the match in the editor
		if (cell.editor) {
			// Set the selection to the match range
			cell.editor.setSelection(match.range);
			// Reveal the range in the editor
			cell.editor.revealRangeInCenter(match.range);
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

NextMatchFindAction.addImplementation(0, (accessor: ServicesAccessor, codeEditor: ICodeEditor, args: unknown) => {
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

PreviousMatchFindAction.addImplementation(0, (accessor: ServicesAccessor, codeEditor: ICodeEditor, args: unknown) => {
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
StartFindAction.addImplementation(100, (accessor: ServicesAccessor, codeEditor: ICodeEditor, args: unknown) => {
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
