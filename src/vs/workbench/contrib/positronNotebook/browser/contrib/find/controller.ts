/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize } from '../../../../../../nls.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { IPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { autorun, observableSignal, observableValue, transaction } from '../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { PositronFindInstance } from './PositronFindInstance.js';
import { PositronNotebookFindDecorations } from './decorations.js';
import { CellEditorRange } from '../../../common/editor/range.js';
import { NotebookCellsChangeType } from '../../../../notebook/common/notebookCommon.js';
import { NotebookTextModel } from '../../../../notebook/common/model/notebookTextModel.js';
import { RunOnceScheduler } from '../../../../../../base/common/async.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { getActiveCell } from '../../selectionMachine.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { CellEditorPosition } from '../../../common/editor/position.js';
import { showHistoryKeybindingHint } from '../../../../../../platform/history/browser/historyWidgetKeybindingHint.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { FindWidgetSearchHistory } from '../../../../../../editor/contrib/find/browser/findWidgetSearchHistory.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';

export class PositronCellFindMatch {
	constructor(
		public readonly cell: IPositronNotebookCell,
		public readonly cellRange: CellEditorRange,
		public readonly matches: string[] | null,
	) { }
}

export class CurrentPositronCellMatch {
	constructor(
		public readonly cellMatch: PositronCellFindMatch,
		public readonly matchIndex: number,
	) { }
}

export class PositronNotebookFindController extends Disposable implements IPositronNotebookContribution {
	public static readonly ID = 'positron.notebook.contrib.findController';

	private _findInstance: PositronFindInstance | undefined;

	/**
	 * Tracks whether the find widget was visible before the view was detached.
	 * Used to restore visibility when the view is reattached.
	 */
	private _wasVisibleBeforeDetach = false;

	/**
	 * Ordered list of all matches across all notebook cells.
	 */
	private readonly _matches = observableValue<PositronCellFindMatch[]>('positronNotebookFindControllerMatches', []);

	/**
	 * The current match and its index in the matches array.
	 */
	private readonly _currentMatch = observableValue<CurrentPositronCellMatch | undefined>('positronNotebookFindControllerCurrentMatchIndex', undefined);

	private readonly _debouncedNotebookContentChanged = observableSignal('positronNotebookContentChanged');
	private readonly _notebookContentChangedScheduler = this._register(new RunOnceScheduler(() => {
		this._debouncedNotebookContentChanged.trigger(undefined, undefined);
	}, 20));

	private readonly _notebookModelDisposables = this._register(new DisposableStore());

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		this._register(this._instantiationService.createInstance(PositronNotebookFindDecorations, this._notebook, this._matches, this._currentMatch));

		this._register(this._notebook.onDidChangeModel((notebookModel) => {
			this.attachNotebookModel(notebookModel);
		}));
		if (this._notebook.textModel) {
			this.attachNotebookModel(this._notebook.textModel);
		}

		// Hide find widget when view is detached, restore when reattached
		this._register(autorun(reader => {
			const container = this._notebook.container.read(reader);
			this._logService.trace(`[FindController] Container autorun: container=${container ? 'attached' : 'detached'}`);

			if (container === undefined) {
				// Detached - save visibility state and hide
				this._wasVisibleBeforeDetach = this._findInstance?.isVisible.read(undefined) ?? false;
				this._logService.trace(`[FindController] Detaching, wasVisible=${this._wasVisibleBeforeDetach}`);
				this._findInstance?.hide();
			} else {
				// Attached - restore visibility if it was visible before
				this._logService.trace(`[FindController] Attaching, wasVisible=${this._wasVisibleBeforeDetach}`);
				if (this._wasVisibleBeforeDetach && this._findInstance) {
					this._findInstance.show();
				}
			}
		}));
	}

	public static get(notebook: IPositronNotebookInstance): PositronNotebookFindController | undefined {
		return notebook.getContribution<PositronNotebookFindController>(PositronNotebookFindController.ID);
	}

	/**
	 * Gets the find instance, creating it if necessary.
	 */
	private getOrCreateFindInstance(): PositronFindInstance {
		if (!this._findInstance) {
			if (!this._notebook.overlayContainer) {
				throw new Error('Notebook overlay container not available for Find Widget rendering');
			}

			// Bind context keys
			const findWidgetVisible = CONTEXT_FIND_WIDGET_VISIBLE.bindTo(this._notebook.scopedContextKeyService);
			const findInputFocused = CONTEXT_FIND_INPUT_FOCUSED.bindTo(this._notebook.scopedContextKeyService);

			// Create the find instance
			const findWidgetSearchHistory = FindWidgetSearchHistory.getOrCreate(this._storageService);
			const findInstance = this._register(new PositronFindInstance({
				container: this._notebook.overlayContainer,
				findInputOptions: {
					label: localize('positronNotebook.find.label', "Find"),
					placeholder: localize('positronNotebook.find.placeholder', "Find"),
					showCommonFindToggles: true,
					inputBoxStyles: defaultInputBoxStyles,
					toggleStyles: defaultToggleStyles,
					showHistoryHint: () => showHistoryKeybindingHint(this._keybindingService),
					history: findWidgetSearchHistory,
				},
				contextKeyService: this._notebook.scopedContextKeyService,
				contextViewService: this._contextViewService,
			}));
			this._findInstance = findInstance;

			// Subscribe to user action events
			this._register(findInstance.onDidRequestFindNext(() => this.findNext()));
			this._register(findInstance.onDidRequestFindPrevious(() => this.findPrevious()));

			// Subscribe to visibility changes
			this._register(autorun((reader) => {
				const visible = findInstance.isVisible.read(reader);
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

					// Restore focus to notebook
					this._notebook.grabFocus();
				}
			}));

			// Subscribe to focus changes
			this._register(autorun((reader) => {
				const focused = findInstance.inputFocused.read(reader);
				if (focused) {
					findInputFocused.set(true);
				} else {
					findInputFocused.reset();
				}
			}));

			// Research when search params or content changes
			this._register(autorun(reader => {
				this._debouncedNotebookContentChanged.read(reader);
				const searchString = findInstance.searchString.read(reader);
				const isRegex = findInstance.isRegex.read(reader);
				const matchCase = findInstance.matchCase.read(reader);
				const wholeWord = findInstance.wholeWord.read(reader);
				const isVisible = findInstance.isVisible.read(reader);

				if (!isVisible) {
					// Not visible, do not search
					return;
				}

				// Perform search
				this.research(searchString, isRegex, matchCase, wholeWord);
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
	 * Hides the find widget.
	 */
	public hide(): void {
		this._findInstance?.hide();
	}

	private attachNotebookModel(notebookModel: NotebookTextModel | undefined) {
		this._notebookModelDisposables.clear();

		if (!notebookModel) {
			return;
		}

		// Schedule the debounced content changed event to trigger researches
		this._notebookModelDisposables.add(notebookModel.onDidChangeContent(e => {
			if (e.rawEvents.some(
				event => event.kind === NotebookCellsChangeType.ChangeCellContent ||
					event.kind === NotebookCellsChangeType.ModelChange)) {
				this._notebookContentChangedScheduler.schedule();
			}
		}));
	}

	/**
	 * Performs a search across all notebook cells.
	 */
	private research(searchString: string, isRegex: boolean, matchCase: boolean, wholeWord: boolean): PositronCellFindMatch[] {
		const cellMatches: PositronCellFindMatch[] = [];
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
				for (const match of matches) {
					const cellRange = new CellEditorRange(cellIndex, match.range);
					const cellMatch = new PositronCellFindMatch(cell, cellRange, match.matches);
					cellMatches.push(cellMatch);
				}
			}
		}

		// Set the match index to the first match after the cursor
		let matchIndex: number | undefined = undefined;
		if (cellMatches.length > 0) {
			const activeCell = getActiveCell(this._notebook.selectionStateMachine.state.get());
			if (activeCell?.currentEditor) {
				// We have an editor with a cursor position
				const position = activeCell.currentEditor.getPosition();
				if (position) {
					const cursorPosition = new CellEditorPosition(activeCell.index, position);
					const foundIndex = cellMatches.findLastIndex(({ cellRange }) =>
						cellRange.containsPosition(cursorPosition) ||
						cellRange.getEndPosition().isBefore(cursorPosition)
					);
					matchIndex = foundIndex !== -1 ? foundIndex : undefined;
				}
			} else if (activeCell) {
				// No editor (e.g., rendered markdown cell), use cell index
				const foundIndex = cellMatches.findLastIndex(({ cellRange }) =>
					cellRange.cellIndex <= activeCell.index
				);
				matchIndex = foundIndex !== -1 ? foundIndex : undefined;
			}
		}

		// Update matches, match count and index
		transaction((tx) => {
			this._matches.set(cellMatches, tx);
			this._findInstance?.matchCount.set(cellMatches.length, tx);
			this._findInstance?.matchIndex.set(matchIndex, tx);
		});

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

		if (cellMatches.length === 0) {
			// No matches
			return -1;
		}

		const currentMatch = this._currentMatch.get();

		if (currentMatch !== undefined) {
			// Current match known. Go to the next match, wrapping if needed
			const nextIndex = currentMatch.matchIndex + 1;
			return nextIndex < cellMatches.length ? nextIndex : 0;
		}

		// If we don't have a current match yet, find first match after cursor
		const activeCell = getActiveCell(this._notebook.selectionStateMachine.state.get());
		if (!activeCell) {
			// No active cell at all
			return -1;
		}

		if (activeCell.currentEditor) {
			// We have an editor with a cursor position
			const position = activeCell.currentEditor.getPosition();
			if (position) {
				const cursorPosition = new CellEditorPosition(activeCell.index, position);
				const nextMatchIndex = cellMatches.findIndex(({ cellRange }) =>
					cellRange.containsPosition(cursorPosition) ||
					cursorPosition.isBefore(cellRange.getStartPosition())
				);
				return nextMatchIndex;
			}
		}

		// No editor (e.g., rendered markdown cell), use cell index
		const nextMatchIndex = cellMatches.findIndex(({ cellRange }) =>
			cellRange.cellIndex >= activeCell.index
		);
		return nextMatchIndex;
	}

	private findPreviousMatchFromCursor(): number {
		const cellMatches = this._matches.get();

		if (cellMatches.length === 0) {
			// No matches
			return -1;
		}

		const currentMatch = this._currentMatch.get();

		if (currentMatch !== undefined) {
			// Current match known. Go to the previous match, wrapping if needed
			const prevIndex = currentMatch.matchIndex - 1;
			return prevIndex >= 0 ? prevIndex : cellMatches.length - 1;
		}

		// If we don't have a current match yet, find last match before cursor
		const activeCell = getActiveCell(this._notebook.selectionStateMachine.state.get());
		if (!activeCell) {
			// No active cell at all
			return -1;
		}

		if (activeCell.currentEditor) {
			// We have an editor with a cursor position
			const position = activeCell.currentEditor.getPosition();
			if (position) {
				const cursorPosition = new CellEditorPosition(activeCell.index, position);
				const prevMatchIndex = cellMatches.findLastIndex(({ cellRange }) =>
					cellRange.containsPosition(cursorPosition) ||
					cellRange.getEndPosition().isBefore(cursorPosition)
				);
				return prevMatchIndex;
			}
		}

		// No editor (e.g., rendered markdown cell), use cell index
		const prevMatchIndex = cellMatches.findLastIndex(({ cellRange }) =>
			cellRange.cellIndex <= activeCell.index
		);
		return prevMatchIndex;
	}

	private navigateToMatch(matchIndex: number): void {
		const cellMatches = this._matches.get();

		if (matchIndex < 0 || matchIndex >= cellMatches.length) {
			// Invalid match index
			return;
		}

		const cellMatch = cellMatches[matchIndex];
		const { cell, cellRange } = cellMatch;

		// Select the cell and reveal it
		this._notebook.selectionStateMachine.selectCell(cell);
		this._notebook.revealInCenterIfOutsideViewport(cell).catch((error) => {
			this._logService.error('Error revealing cell for find match:', error);
		});

		// Select the match in the editor
		if (cell.currentEditor) {
			// Set the selection to the match range
			cell.currentEditor.setSelection(cellRange.range);
			// Reveal the range in the editor
			cell.currentEditor.revealRangeInCenter(cellRange.range);
		}

		transaction((tx) => {
			// Update the match index
			this._findInstance?.matchIndex.set(matchIndex, tx);

			// Update current match tracking
			this._currentMatch.set({ cellMatch, matchIndex: matchIndex }, tx);
		});
	}
}
