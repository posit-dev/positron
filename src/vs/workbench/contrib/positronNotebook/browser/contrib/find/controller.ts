/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_FIND_WIDGET_VISIBLE } from '../../../../../../editor/contrib/find/browser/findModel.js';
import { localize } from '../../../../../../nls.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { IPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { autorun, observableValue, runOnChange, transaction } from '../../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { PositronFindInstance } from './PositronFindInstance.js';
import { PositronNotebookFindDecorations } from './decorations.js';
import { CellEditorRange } from '../../../common/editor/range.js';

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
	 * Ordered list of all matches across all notebook cells.
	 */
	private readonly _matches = observableValue<PositronCellFindMatch[]>('positronNotebookFindControllerMatches', []);

	/**
	 * The current match and its index in the matches array.
	 */
	private readonly _currentMatch = observableValue<CurrentPositronCellMatch | undefined>('positronNotebookFindControllerCurrentMatchIndex', undefined);

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

				// Perform search
				const cellMatches = this.research(searchString, isRegex, matchCase, wholeWord);

				// Set the match index to the first match after the cursor
				let matchIndex: number | undefined = undefined;
				const cursorPosition = this._notebook.getActiveEditorPosition();
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
	 * Hides the find widget.
	 */
	public hide(): void {
		this._findInstance?.hide();
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
		const cursorPosition = this._notebook.getActiveEditorPosition();
		if (!cursorPosition) {
			// No cursor
			return -1;
		}

		// Find the first match after the cursor
		const nextMatchIndex = cellMatches.findIndex(({ cellRange }) =>
			cellRange.containsPosition(cursorPosition) ||
			cursorPosition.isBefore(cellRange.getStartPosition())
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
		const cursorPosition = this._notebook.getActiveEditorPosition();
		if (!cursorPosition) {
			// No cursor
			return -1;
		}

		// Find the last match before the cursor
		const prevMatchIndex = cellMatches.findLastIndex(({ cellRange }) =>
			cellRange.containsPosition(cursorPosition) ||
			cellRange.getEndPosition().isBefore(cursorPosition)
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

		// Select the cell (and reveal it)
		this._notebook.selectionStateMachine.selectCell(cell);

		// Select the match in the editor
		if (cell.editor) {
			// Set the selection to the match range
			cell.editor.setSelection(cellRange.range);
			// Reveal the range in the editor
			cell.editor.revealRangeInCenter(cellRange.range);
		}

		transaction((tx) => {
			// Update the match index
			this._findInstance?.matchIndex.set(matchIndex, tx);

			// Update current match tracking
			this._currentMatch.set({ cellMatch, matchIndex: matchIndex }, tx);
		});
	}
}
