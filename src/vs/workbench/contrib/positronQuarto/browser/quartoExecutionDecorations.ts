/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IModelDeltaDecoration, IModelDecorationOptions, OverviewRulerLane, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { Range } from '../../../../editor/common/core/range.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { localize } from '../../../../nls.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { CellExecutionState, IQuartoExecutionManager } from '../common/quartoExecutionTypes.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { QUARTO_INLINE_OUTPUT_ENABLED, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { IEditorContribution, IEditorDecorationsCollection } from '../../../../editor/common/editorCommon.js';

// Import CSS
import './media/quartoExecutionDecorations.css';

/**
 * Theme color for queued execution gutter marker.
 */
export const quartoExecutionQueued = registerColor(
	'editorGutter.quartoQueuedBackground',
	{ dark: '#1B81A8', light: '#2090D3', hcDark: '#1B81A8', hcLight: '#2090D3' },
	localize('quartoQueuedBackground', 'Gutter color for queued Quarto cell execution')
);

/**
 * Theme color for running execution gutter marker.
 */
export const quartoExecutionRunning = registerColor(
	'editorGutter.quartoRunningBackground',
	{ dark: '#487E02', light: '#48985D', hcDark: '#487E02', hcLight: '#48985D' },
	localize('quartoRunningBackground', 'Gutter color for running Quarto cell execution')
);

/**
 * Theme color for error execution gutter marker.
 */
export const quartoExecutionError = registerColor(
	'editorGutter.quartoErrorBackground',
	{ dark: '#B52A2A', light: '#D32F2F', hcDark: '#B52A2A', hcLight: '#D32F2F' },
	localize('quartoErrorBackground', 'Gutter color for Quarto cell execution errors')
);

/**
 * Decoration options for queued cells - first line of multi-line cell.
 */
const queuedFirstDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution-first',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued-first',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

/**
 * Decoration options for queued cells - middle lines of multi-line cell.
 */
const queuedMiddleDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution-middle',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued-middle',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

/**
 * Decoration options for queued cells - last line of multi-line cell.
 */
const queuedLastDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution-last',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued-last',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		// Use the same color as running, but with hollow gutter decoration
		color: themeColorFromId(quartoExecutionRunning),
		position: OverviewRulerLane.Full,
	},
};

/**
 * Decoration options for queued cells - single line cell.
 */
const queuedSingleDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution-single',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued-single',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		// Use the same color as running, but with hollow gutter decoration
		color: themeColorFromId(quartoExecutionRunning),
		position: OverviewRulerLane.Full,
	},
};

/**
 * Number of animation delay variants for the running state.
 * Each variant has a different animation-delay to create a "twinkle" effect.
 */
const RUNNING_DELAY_VARIANTS = 10;

/**
 * Creates decoration options for running cells with staggered animation delays.
 * @param isError Whether this is for error state (red) or success state (green)
 */
function createRunningDecorationOptions(isError: boolean): IModelDecorationOptions[] {
	const prefix = isError ? 'error-' : '';
	const color = isError ? quartoExecutionError : quartoExecutionRunning;
	const tooltip = isError
		? localize('quartoErrorRunning', 'Executing with error')
		: localize('quartoRunning', 'Currently executing');

	return Array.from({ length: RUNNING_DELAY_VARIANTS }, (_, i) => ({
		description: `quarto-${prefix}running-execution-${i}`,
		isWholeLine: true,
		linesDecorationsClassName: `quarto-execution-${prefix}running-${i}`,
		linesDecorationsTooltip: tooltip,
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		overviewRuler: {
			color: themeColorFromId(color),
			position: OverviewRulerLane.Full,
		},
	}));
}

/**
 * Creates decoration options for completed cells.
 * @param isError Whether this is for error state (red) or success state (green)
 * @param isFading Whether this is for the fading phase
 */
function createCompletedDecorationOptions(isError: boolean, isFading: boolean): IModelDecorationOptions {
	const prefix = isError ? 'error-' : '';
	const suffix = isFading ? '-fading' : '';
	return {
		description: `quarto-${prefix}completed-execution${suffix}`,
		isWholeLine: true,
		linesDecorationsClassName: `quarto-execution-${prefix}completed${suffix}`,
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	};
}

// Pre-create decoration options for both success and error states
const runningDecorationOptions = createRunningDecorationOptions(false);
const errorRunningDecorationOptions = createRunningDecorationOptions(true);
const completedDecorationOptions = createCompletedDecorationOptions(false, false);
const completedFadingDecorationOptions = createCompletedDecorationOptions(false, true);
const errorCompletedDecorationOptions = createCompletedDecorationOptions(true, false);
const errorCompletedFadingDecorationOptions = createCompletedDecorationOptions(true, true);

/**
 * Duration in ms to show solid green after execution completes.
 */
const COMPLETED_SOLID_DURATION = 500;

/**
 * Duration in ms for the fade out animation.
 */
const COMPLETED_FADE_DURATION = 300;

/**
 * Tracks a completed cell's line range, current phase, and error state.
 */
interface CompletedCellInfo {
	startLine: number;
	endLine: number;
	phase: 'solid' | 'fading';
	timeoutId: ReturnType<typeof setTimeout>;
	/** Whether the cell had an error during execution */
	hadError: boolean;
}

/**
 * Editor contribution that manages gutter decorations for Quarto cell execution state.
 * Shows visual indicators for cells that are queued or currently running.
 */
export class QuartoExecutionDecorations extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoExecutionDecorations';

	private _decorationsCollection: IEditorDecorationsCollection | undefined;
	private readonly _disposables = this._register(new DisposableStore());

	/** Tracks cells that were running in the previous update */
	private readonly _previouslyRunningCells = new Set<string>();

	/** Tracks cells in the completed animation phase */
	private readonly _completedCells = new Map<string, CompletedCellInfo>();

	/** Tracks the execution range for running cells (for the completion animation) */
	private readonly _runningCellRanges = new Map<string, { startLine: number; endLine: number }>();

	/** Tracks cells that have encountered errors during execution */
	private readonly _cellsWithErrors = new Set<string>();

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
	) {
		super();

		// Only activate for .qmd files when feature is enabled
		this._register(this._editor.onDidChangeModel(() => {
			this._onEditorModelChanged();
		}));

		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([QUARTO_INLINE_OUTPUT_ENABLED.key]))) {
				this._onEditorModelChanged();
			}
		}));

		// Initial setup
		this._onEditorModelChanged();
	}

	/**
	 * Called when the editor model changes.
	 * Sets up or tears down decorations based on whether this is a Quarto document.
	 */
	private _onEditorModelChanged(): void {
		// Clean up previous decorations
		this._disposables.clear();
		this._decorationsCollection?.clear();
		this._decorationsCollection = undefined;
		this._clearCompletedCells();

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		// Check if feature is enabled (context key checks both setting and extension installation)
		const enabled = this._contextKeyService.getContextKeyValue<boolean>(QUARTO_INLINE_OUTPUT_ENABLED.key) ?? false;
		if (!enabled) {
			return;
		}

		// Check if this is a Quarto or RMarkdown document (by extension or language ID)
		const uri = model.uri;
		if (!isQuartoDocument(uri.path, model.getLanguageId())) {
			return;
		}

		// Set up decorations collection
		this._decorationsCollection = this._editor.createDecorationsCollection();

		// Listen for execution state changes
		this._disposables.add(this._executionManager.onDidChangeExecutionState((e) => {
			// When a cell starts running, clear any previous error state
			if (e.execution.state === CellExecutionState.Running) {
				this._cellsWithErrors.delete(e.execution.cellId);
			}
			this._updateDecorations();
		}));

		// Listen for output to detect errors
		this._disposables.add(this._executionManager.onDidReceiveOutput((e) => {
			// Check if this is an error output
			const hasError = e.output.items.some(item =>
				item.mime === 'application/vnd.code.notebook.error' ||
				item.mime === 'application/vnd.code.notebook.stderr'
			);
			if (hasError) {
				this._cellsWithErrors.add(e.cellId);
				this._updateDecorations();
			}
		}));

		// Listen for document content changes
		this._disposables.add(model.onDidChangeContent(() => {
			this._updateDecorations();
		}));

		// Initial decoration update
		this._updateDecorations();
	}

	/**
	 * Update decorations based on current execution state.
	 */
	private _updateDecorations(): void {
		if (!this._decorationsCollection) {
			return;
		}

		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		// Get the Quarto document model
		const quartoModel = this._documentModelService.getModel(model);
		const cells = quartoModel.cells;

		const decorations: IModelDeltaDecoration[] = [];
		const currentlyRunningCells = new Set<string>();

		for (const cell of cells) {
			const state = this._executionManager.getExecutionState(cell.id);
			const queuedRanges = this._executionManager.getQueuedRanges(cell.id);

			if (state === CellExecutionState.Running) {
				currentlyRunningCells.add(cell.id);

				// If this cell was previously completed (re-running), cancel its completion animation
				if (this._completedCells.has(cell.id)) {
					this._cancelCompletedCell(cell.id);
				}

				// Check if we have a specific execution range (for partial cell execution)
				const executionRange = this._executionManager.getExecutionRange(cell.id);

				// Determine the line range to decorate for running state
				let startLine: number;
				let endLine: number;

				if (executionRange) {
					// Use the specific execution range (partial cell execution)
					startLine = executionRange.startLineNumber;
					endLine = executionRange.endLineNumber;
				} else {
					// Fall back to the full cell range
					startLine = cell.startLine;
					endLine = cell.endLine;
				}

				// Save the line range for the completion animation
				this._runningCellRanges.set(cell.id, { startLine, endLine });

				// Apply a separate decoration per line with a random animation delay variant
				// This creates an organic "twinkle" effect where each line pulses independently
				// Use error decorations if the cell has encountered an error
				const hasError = this._cellsWithErrors.has(cell.id);
				const decorationOptions = hasError ? errorRunningDecorationOptions : runningDecorationOptions;
				for (let line = startLine; line <= endLine; line++) {
					const variantIndex = Math.floor(Math.random() * RUNNING_DELAY_VARIANTS);
					decorations.push({
						range: new Range(line, 1, line, 1),
						options: decorationOptions[variantIndex],
					});
				}

				// Also add queued decorations for any queued ranges within this running cell
				for (const queuedRange of queuedRanges) {
					this._addQueuedRangeDecorations(decorations, queuedRange);
				}
			} else if (state === CellExecutionState.Queued && queuedRanges.length === 0) {
				// Full cell is queued (no specific ranges) - show queued decoration for entire cell
				// Use codeStartLine/codeEndLine to match the lines decorated when running
				const isSingleLine = cell.codeStartLine === cell.codeEndLine;
				if (isSingleLine) {
					decorations.push({
						range: new Range(cell.codeStartLine, 1, cell.codeStartLine, 1),
						options: queuedSingleDecorationOptions,
					});
				} else {
					// First line
					decorations.push({
						range: new Range(cell.codeStartLine, 1, cell.codeStartLine, 1),
						options: queuedFirstDecorationOptions,
					});
					// Middle lines
					for (let line = cell.codeStartLine + 1; line < cell.codeEndLine; line++) {
						decorations.push({
							range: new Range(line, 1, line, 1),
							options: queuedMiddleDecorationOptions,
						});
					}
					// Last line
					decorations.push({
						range: new Range(cell.codeEndLine, 1, cell.codeEndLine, 1),
						options: queuedLastDecorationOptions,
					});
				}
			} else if (queuedRanges.length > 0) {
				// Cell has specific queued ranges (inline/linewise execution)
				for (const queuedRange of queuedRanges) {
					this._addQueuedRangeDecorations(decorations, queuedRange);
				}
			}
		}

		// Detect cells that stopped running and start completion animation
		for (const cellId of this._previouslyRunningCells) {
			if (!currentlyRunningCells.has(cellId)) {
				// Check if this cell had an error
				const hadError = this._cellsWithErrors.has(cellId);
				// Use the saved execution range (for partial cell execution) or fall back to full cell range
				const savedRange = this._runningCellRanges.get(cellId);
				if (savedRange) {
					this._startCompletedAnimation(cellId, savedRange.startLine, savedRange.endLine, hadError);
					// Clean up the saved range
					this._runningCellRanges.delete(cellId);
				} else {
					// Fall back to full cell range
					const cell = cells.find(c => c.id === cellId);
					if (cell) {
						this._startCompletedAnimation(cellId, cell.startLine, cell.endLine, hadError);
					}
				}
			}
		}

		// Update the set of previously running cells
		this._previouslyRunningCells.clear();
		for (const cellId of currentlyRunningCells) {
			this._previouslyRunningCells.add(cellId);
		}

		// Add decorations for completed cells
		for (const [, info] of this._completedCells) {
			let options: IModelDecorationOptions;
			if (info.hadError) {
				options = info.phase === 'solid' ? errorCompletedDecorationOptions : errorCompletedFadingDecorationOptions;
			} else {
				options = info.phase === 'solid' ? completedDecorationOptions : completedFadingDecorationOptions;
			}
			for (let line = info.startLine; line <= info.endLine; line++) {
				decorations.push({
					range: new Range(line, 1, line, 1),
					options,
				});
			}
		}

		this._decorationsCollection.set(decorations);
	}

	/**
	 * Start the completion animation for a cell.
	 * Note: Does not call _updateDecorations - caller is responsible for rendering.
	 * @param cellId The cell ID
	 * @param startLine Starting line of the execution range
	 * @param endLine Ending line of the execution range
	 * @param hadError Whether the cell had an error during execution
	 */
	private _startCompletedAnimation(cellId: string, startLine: number, endLine: number, hadError: boolean): void {
		// Cancel any existing animation for this cell
		this._cancelCompletedCell(cellId);

		// Start with solid phase
		const timeoutId = setTimeout(() => {
			// Transition to fading phase
			const info = this._completedCells.get(cellId);
			if (info) {
				info.phase = 'fading';
				info.timeoutId = setTimeout(() => {
					// Remove the completed cell after fade completes
					this._completedCells.delete(cellId);
					// Clean up error state when animation completes
					this._cellsWithErrors.delete(cellId);
					this._updateDecorations();
				}, COMPLETED_FADE_DURATION);
				this._updateDecorations();
			}
		}, COMPLETED_SOLID_DURATION);

		this._completedCells.set(cellId, {
			startLine,
			endLine,
			phase: 'solid',
			timeoutId,
			hadError,
		});
		// Decorations will be rendered by the caller's _updateDecorations call
	}

	/**
	 * Add queued range decorations for a specific range.
	 * Applies the appropriate first/middle/last/single decoration style based on range size.
	 */
	private _addQueuedRangeDecorations(decorations: IModelDeltaDecoration[], range: Range): void {
		const startLine = range.startLineNumber;
		const endLine = range.endLineNumber;
		const isSingleLine = startLine === endLine;

		if (isSingleLine) {
			decorations.push({
				range: new Range(startLine, 1, startLine, 1),
				options: queuedSingleDecorationOptions,
			});
		} else {
			// First line
			decorations.push({
				range: new Range(startLine, 1, startLine, 1),
				options: queuedFirstDecorationOptions,
			});
			// Middle lines
			for (let line = startLine + 1; line < endLine; line++) {
				decorations.push({
					range: new Range(line, 1, line, 1),
					options: queuedMiddleDecorationOptions,
				});
			}
			// Last line
			decorations.push({
				range: new Range(endLine, 1, endLine, 1),
				options: queuedLastDecorationOptions,
			});
		}
	}

	/**
	 * Cancel the completion animation for a specific cell.
	 */
	private _cancelCompletedCell(cellId: string): void {
		const info = this._completedCells.get(cellId);
		if (info) {
			clearTimeout(info.timeoutId);
			this._completedCells.delete(cellId);
		}
	}

	/**
	 * Clear all completed cell animations.
	 */
	private _clearCompletedCells(): void {
		for (const [, info] of this._completedCells) {
			clearTimeout(info.timeoutId);
		}
		this._completedCells.clear();
		this._previouslyRunningCells.clear();
		this._runningCellRanges.clear();
		this._cellsWithErrors.clear();
	}

	override dispose(): void {
		this._clearCompletedCells();
		this._decorationsCollection?.clear();
		super.dispose();
	}
}
