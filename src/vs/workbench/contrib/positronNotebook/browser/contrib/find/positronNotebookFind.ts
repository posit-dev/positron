/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import React from 'react';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
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
import { observableValue, runOnChange, transaction } from '../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { PositronFindWidget } from './PositronFindWidget.js';
import { Toggle } from '../../../../../../base/browser/ui/toggle/toggle.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { getActiveCell } from '../../selectionMachine.js';
import { NextMatchFindAction, PreviousMatchFindAction } from '../../../../../../editor/contrib/find/browser/findController.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';

interface CellMatch {
	cell: IPositronNotebookCell;
	cellIndex: number;
	match: FindMatch;
}

/** TODO: Note that this is tied to one notebook instance lifecycle */
export class PositronNotebookFindController extends Disposable implements IPositronNotebookContribution {
	public static readonly ID = 'positron.notebook.contrib.findController';

	private readonly _renderer = this._register(new MutableDisposable<PositronModalReactRenderer>());
	private readonly _decorationIdsByCellHandle = new Map<number, string[]>();
	private _allMatches: CellMatch[] = [];
	// private readonly _findInstance?: FindInstance;

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	public static get(notebook: IPositronNotebookInstance): PositronNotebookFindController | undefined {
		return notebook.getContribution<PositronNotebookFindController>(PositronNotebookFindController.ID);
	}

	public readonly searchString = observableValue('findStateSearchString', '');
	public readonly isRegex = observableValue('findStateIsRegexActual', false);
	public readonly wholeWord = observableValue('findStateWholeWordActual', false);
	public readonly matchCase = observableValue('findStateMatchCaseActual', false);
	public readonly preserveCase = observableValue('findStatePreserveCaseActual', false);
	public readonly matchIndex = observableValue<number | undefined>('findStateMatchIndex', undefined);
	public readonly matchCount = observableValue<number | undefined>('findStateMatchCount', undefined);

	public start(): void {
		if (!this._notebook.scopedContextKeyService) {
			return;
		}

		// TODO: Feels like this should be a class...
		const findWidgetVisible = CONTEXT_FIND_WIDGET_VISIBLE.bindTo(this._notebook.scopedContextKeyService);
		const findInputFocused = CONTEXT_FIND_INPUT_FOCUSED.bindTo(this._notebook.scopedContextKeyService);

		const disposables = new DisposableStore();

		// Create find in selection toggle for notebook-specific functionality
		const findInSelectionToggle = disposables.add(new Toggle({
			icon: Codicon.selection,
			title: 'Find in Selection',
			isChecked: false,
			...defaultToggleStyles,
		}));

		disposables.add(findInSelectionToggle.onChange(() => {
			// TODO: Implement find in selection logic for notebooks
			console.log('Find in selection toggled');
		}));

		if (!this._renderer.value) {
			if (!this._notebook.container?.parentElement) {
				return;
			}

			this._renderer.value = new PositronModalReactRenderer({
				container: this._notebook.container.parentElement,
				disableCaptures: true, // permits the usage of the enter key where applicable
				onDisposed: () => {
					// activeFindWidgets.delete(container);
					disposables.dispose();
					findWidgetVisible.reset();
					findInputFocused.reset();
				}
			});
		}

		const findWidget = React.createElement(PositronFindWidget, {
			findInputOptions: {
				label: 'Find', // localize?
				placeholder: 'Find', // localize?
				showCommonFindToggles: true,
				inputBoxStyles: defaultInputBoxStyles,
				toggleStyles: defaultToggleStyles,
				additionalToggles: [findInSelectionToggle],
			},
			findText: this.searchString,
			focusInput: true,
			matchCase: this.matchCase,
			matchWholeWord: this.wholeWord,
			useRegex: this.isRegex,
			matchIndex: this.matchIndex,
			matchCount: this.matchCount,
			onPreviousMatch: () => this.findPrevious(),
			onNextMatch: () => this.findNext(),
			onClose: () => {
				this._renderer.clear();
			},
			onInputFocus: () => {
				findInputFocused.set(true);
			},
			onInputBlur: () => {
				findInputFocused.set(false);
			},
		});

		disposables.add(runOnChange(this.searchString, (searchString) => {
			this.research(searchString);
		}));

		this._renderer.value.render(findWidget);

		// TODO: onVisible?
		findWidgetVisible.set(true);
	}

	// TODO: Make option object and pass in instead of reading observables. This method will eventually live on a delegate
	private research(searchString: string): void {
		this._allMatches = [];
		let totalMatchCount = 0;

		for (const cell of this._notebook.cells.get()) {
			if (cell.model.textModel) {
				const wordSeparators = this._configurationService.inspect<string>('editor.wordSeparators').value;
				const cellMatches = cell.model.textModel.findMatches(
					searchString,
					null,
					this.isRegex.get(),
					this.matchCase.get(),
					this.wholeWord.get() ? wordSeparators || null : null,
					this.isRegex.get(),
				);

				// Store each match with its cell reference and index
				const cellIndex = cell.index;
				for (const match of cellMatches) {
					this._allMatches.push({ cell, cellIndex, match });
				}
				totalMatchCount += cellMatches.length;
				// TODO: Fall back to text buffer if no text model?

				const newDecorations: IModelDeltaDecoration[] = [];
				for (const match of cellMatches) {
					newDecorations.push({
						range: match.range,
						options: {
							description: 'text search range for notebook search scope',
							// isWholeLine: true,
							className: 'nb-findScope'
						}
					});
				}

				const oldDecorationIds = this._decorationIdsByCellHandle.get(cell.handle) || [];
				cell.editor?.changeDecorations(accessor => {
					const newDecorationIds = accessor.deltaDecorations(oldDecorationIds, newDecorations);
					this._decorationIdsByCellHandle.set(cell.handle, newDecorationIds);
				});

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
			this.matchCount.set(totalMatchCount, tx);
			this.matchIndex.set(totalMatchCount > 0 ? 1 : undefined, tx);
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

	private navigateToMatch(matchIndex: number): void {
		if (matchIndex < 1 || matchIndex > this._allMatches.length) {
			return;
		}

		const { cell, match } = this._allMatches[matchIndex - 1]; // Convert to 0-based index

		// Reveal the cell in the notebook
		if (cell.container) {
			cell.container.scrollIntoView({ behavior: 'instant', block: 'center' });
		}

		// Focus the cell
		if (cell.editor) {
			// Set the selection to the match range
			cell.editor.setSelection(match.range);
			// Reveal the range in the editor
			cell.editor.revealRangeInCenter(match.range);
			// Focus the editor
			cell.editor.focus();
		}

		// Update the match index
		this.matchIndex.set(matchIndex, undefined);
	}

	public closeFindWidget(): void {
		this._renderer.clear();
	}
}

// class FindInstance {
// 	// TODO: Who should render the find instance component?...
// }

registerPositronNotebookContribution(PositronNotebookFindController.ID, PositronNotebookFindController);

abstract class PositronNotebookFindAction extends NotebookAction2 {
	override async runNotebookAction(notebook: IPositronNotebookInstance, _accessor: ServicesAccessor): Promise<void> {
		const controller = PositronNotebookFindController.get(notebook);
		// controller.show(undefined, { findScope: { findScopeType: NotebookFindScopeType.None } });
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
		// controller.show(undefined, { findScope: { findScopeType: NotebookFindScopeType.None } });
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
		controller.closeFindWidget();
		// editor.focus();
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
