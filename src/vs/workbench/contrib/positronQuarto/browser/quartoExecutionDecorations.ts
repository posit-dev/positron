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
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY, isQuartoDocument } from '../common/positronQuartoConfig.js';
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
 * Decoration options for running cells.
 * Multiple variants with different CSS classes to create staggered animation delays.
 * This prevents the animation reset issue when decorations are redrawn.
 */
const runningDecorationOptions: IModelDecorationOptions[] = Array.from(
	{ length: RUNNING_DELAY_VARIANTS },
	(_, i) => ({
		description: `quarto-running-execution-${i}`,
		isWholeLine: true,
		linesDecorationsClassName: `quarto-execution-running-${i}`,
		linesDecorationsTooltip: localize('quartoRunning', 'Currently executing'),
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		overviewRuler: {
			color: themeColorFromId(quartoExecutionRunning),
			position: OverviewRulerLane.Full,
		},
	})
);

/**
 * Decoration options for completed cells - solid green (no animation).
 */
const completedDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-completed-execution',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-completed',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

/**
 * Decoration options for completed cells during fade out.
 */
const completedFadingDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-completed-execution-fading',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-completed-fading',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

/**
 * Duration in ms to show solid green after execution completes.
 */
const COMPLETED_SOLID_DURATION = 500;

/**
 * Duration in ms for the fade out animation.
 */
const COMPLETED_FADE_DURATION = 300;

/**
 * Tracks a completed cell's line range and current phase.
 */
interface CompletedCellInfo {
	startLine: number;
	endLine: number;
	phase: 'solid' | 'fading';
	timeoutId: ReturnType<typeof setTimeout>;
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

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		// Only activate for .qmd files when feature is enabled
		this._register(this._editor.onDidChangeModel(() => {
			this._onEditorModelChanged();
		}));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
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

		// Check if feature is enabled
		const enabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
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
		this._disposables.add(this._executionManager.onDidChangeExecutionState(() => {
			this._updateDecorations();
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

			if (state === CellExecutionState.Queued) {
				// For queued cells, apply different decorations per line to form a single outline
				const isSingleLine = cell.startLine === cell.endLine;
				if (isSingleLine) {
					decorations.push({
						range: new Range(cell.startLine, 1, cell.startLine, 1),
						options: queuedSingleDecorationOptions,
					});
				} else {
					// First line
					decorations.push({
						range: new Range(cell.startLine, 1, cell.startLine, 1),
						options: queuedFirstDecorationOptions,
					});
					// Middle lines
					for (let line = cell.startLine + 1; line < cell.endLine; line++) {
						decorations.push({
							range: new Range(line, 1, line, 1),
							options: queuedMiddleDecorationOptions,
						});
					}
					// Last line
					decorations.push({
						range: new Range(cell.endLine, 1, cell.endLine, 1),
						options: queuedLastDecorationOptions,
					});
				}
			} else if (state === CellExecutionState.Running) {
				currentlyRunningCells.add(cell.id);

				// If this cell was previously completed (re-running), cancel its completion animation
				if (this._completedCells.has(cell.id)) {
					this._cancelCompletedCell(cell.id);
				}

				// Apply a separate decoration per line with a random animation delay variant
				// This creates an organic "twinkle" effect where each line pulses independently
				for (let line = cell.startLine; line <= cell.endLine; line++) {
					const variantIndex = Math.floor(Math.random() * RUNNING_DELAY_VARIANTS);
					decorations.push({
						range: new Range(line, 1, line, 1),
						options: runningDecorationOptions[variantIndex],
					});
				}
			}
		}

		// Detect cells that stopped running and start completion animation
		for (const cellId of this._previouslyRunningCells) {
			if (!currentlyRunningCells.has(cellId)) {
				// Find the cell to get its line range
				const cell = cells.find(c => c.id === cellId);
				if (cell) {
					this._startCompletedAnimation(cellId, cell.startLine, cell.endLine);
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
			const options = info.phase === 'solid' ? completedDecorationOptions : completedFadingDecorationOptions;
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
	 */
	private _startCompletedAnimation(cellId: string, startLine: number, endLine: number): void {
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
		});
		// Decorations will be rendered by the caller's _updateDecorations call
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
	}

	override dispose(): void {
		this._clearCompletedCells();
		this._decorationsCollection?.clear();
		super.dispose();
	}
}
