/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { IModelDeltaDecoration, IModelDecorationOptions, OverviewRulerLane, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Range } from '../../../../editor/common/core/range.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { localize } from '../../../../nls.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { CellExecutionState, IQuartoExecutionManager } from '../common/quartoExecutionTypes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { themeColorFromId, IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorContribution, IEditorDecorationsCollection } from '../../../../editor/common/editorCommon.js';
import { Color } from '../../../../base/common/color.js';

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
 * Decoration options for queued cells - middle lines (left/right borders only).
 * Uses the same color as running cells but renders as hollow rectangle in the gutter.
 */
const queuedDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		color: themeColorFromId(quartoExecutionRunning),
		position: OverviewRulerLane.Full,
	},
};

/**
 * Decoration options for first line of queued cells (top + left/right borders).
 */
const queuedFirstLineDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution-first',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued-first',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

/**
 * Decoration options for last line of queued cells (bottom + left/right borders).
 */
const queuedLastLineDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution-last',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued-last',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
};

/**
 * Decoration options for single-line queued cells (all borders).
 */
const queuedSingleLineDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution-single',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued-single',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		color: themeColorFromId(quartoExecutionRunning),
		position: OverviewRulerLane.Full,
	},
};

/**
 * Decoration options for running cells.
 * Note: The animated noise effect is handled by the RunningCellNoiseOverlay,
 * not by CSS. This decoration just marks the lines for the overview ruler.
 */
const runningDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-running-execution',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-running',
	linesDecorationsTooltip: localize('quartoRunning', 'Currently executing'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		color: themeColorFromId(quartoExecutionRunning),
		position: OverviewRulerLane.Full,
	},
};

/**
 * Canvas-based overlay widget that renders animated noise over running cells.
 * This provides a more organic, random-looking animation than CSS can achieve.
 */
class RunningCellNoiseOverlay implements IOverlayWidget {
	private static readonly ID = 'quarto.runningCellNoiseOverlay';
	private static readonly DECORATION_WIDTH = 10;
	private static readonly ANIMATION_INTERVAL_MS = 80; // Throttle animation speed

	private readonly _domNode: HTMLElement;
	private readonly _canvas: HTMLCanvasElement;
	private readonly _ctx: CanvasRenderingContext2D;
	private _animationFrameId: number | null = null;
	private _lastRenderTime = 0;
	private _runningRanges: Array<{ startLine: number; endLine: number }> = [];
	private _baseColor: Color = Color.fromHex('#48985D');
	private _disposed = false;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _themeService: IThemeService,
	) {
		this._domNode = document.createElement('div');
		this._domNode.className = 'quarto-running-noise-overlay';
		this._domNode.style.position = 'absolute';
		this._domNode.style.pointerEvents = 'none';
		this._domNode.style.overflow = 'hidden';

		this._canvas = document.createElement('canvas');
		this._domNode.appendChild(this._canvas);

		const ctx = this._canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Failed to get 2d context');
		}
		this._ctx = ctx;

		// Update color from theme
		this._updateColorFromTheme();
		this._themeService.onDidColorThemeChange(() => {
			this._updateColorFromTheme();
		});
	}

	private _updateColorFromTheme(): void {
		const theme = this._themeService.getColorTheme();
		const color = theme.getColor(quartoExecutionRunning);
		if (color) {
			this._baseColor = color;
		}
	}

	getId(): string {
		return RunningCellNoiseOverlay.ID;
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		// We position ourselves manually
		return null;
	}

	/**
	 * Update which line ranges should show the noise effect.
	 */
	setRunningRanges(ranges: Array<{ startLine: number; endLine: number }>): void {
		this._runningRanges = ranges;

		if (ranges.length > 0 && !this._animationFrameId) {
			this._startAnimation();
		} else if (ranges.length === 0 && this._animationFrameId) {
			this._stopAnimation();
		}

		this._updatePosition();
	}

	private _updatePosition(): void {
		if (this._runningRanges.length === 0) {
			this._domNode.style.display = 'none';
			return;
		}

		const layout = this._editor.getLayoutInfo();
		const decorationWidth = RunningCellNoiseOverlay.DECORATION_WIDTH;

		// Position just before the content area (in the line decorations gutter)
		// This is between the line numbers and the actual code content
		const marginLeft = layout.contentLeft - decorationWidth - 4;

		this._domNode.style.display = 'block';
		this._domNode.style.left = `${marginLeft}px`;
		this._domNode.style.top = '0px';
		this._domNode.style.width = `${decorationWidth}px`;
		this._domNode.style.height = `${layout.height}px`;

		// Size canvas to match (setting width/height resets the context transform)
		const dpr = window.devicePixelRatio || 1;
		this._canvas.width = decorationWidth * dpr;
		this._canvas.height = layout.height * dpr;
		this._canvas.style.width = `${decorationWidth}px`;
		this._canvas.style.height = `${layout.height}px`;
		// Reset transform and scale for DPR
		this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	private _startAnimation(): void {
		if (this._disposed) {
			return;
		}

		const animate = (timestamp: number) => {
			if (this._disposed) {
				return;
			}

			// Throttle the animation to avoid excessive CPU usage and slow down the effect
			if (timestamp - this._lastRenderTime >= RunningCellNoiseOverlay.ANIMATION_INTERVAL_MS) {
				this._render();
				this._lastRenderTime = timestamp;
			}

			this._animationFrameId = requestAnimationFrame(animate);
		};

		this._animationFrameId = requestAnimationFrame(animate);
	}

	private _stopAnimation(): void {
		if (this._animationFrameId) {
			cancelAnimationFrame(this._animationFrameId);
			this._animationFrameId = null;
		}
		// Clear the canvas
		this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
	}

	private _render(): void {
		if (this._runningRanges.length === 0) {
			return;
		}

		const layout = this._editor.getLayoutInfo();
		const decorationWidth = RunningCellNoiseOverlay.DECORATION_WIDTH;
		const scrollTop = this._editor.getScrollTop();

		// Clear canvas
		this._ctx.clearRect(0, 0, decorationWidth, layout.height);

		// Get base color components
		const r = this._baseColor.rgba.r;
		const g = this._baseColor.rgba.g;
		const b = this._baseColor.rgba.b;

		// For each running range, render noise
		for (const range of this._runningRanges) {
			// Use editor's getTopForLineNumber for accurate positioning that accounts for view zones
			const topPx = this._editor.getTopForLineNumber(range.startLine) - scrollTop;
			const bottomPx = this._editor.getTopForLineNumber(range.endLine + 1) - scrollTop;

			// Skip if completely out of view
			if (bottomPx < 0 || topPx > layout.height) {
				continue;
			}

			// Clamp to visible area
			const visibleTop = Math.max(0, topPx);
			const visibleBottom = Math.min(layout.height, bottomPx);
			const height = Math.ceil(visibleBottom - visibleTop);

			if (height <= 0) {
				continue;
			}

			// Create noise pattern with random variation
			// Use ImageData for per-pixel control
			const imageData = this._ctx.createImageData(decorationWidth, height);
			const data = imageData.data;

			for (let y = 0; y < height; y++) {
				for (let x = 0; x < decorationWidth; x++) {
					const idx = (y * decorationWidth + x) * 4;

					// Generate random intensity variation
					// Range from 0.3 to 1.0 for good contrast
					const noise = 0.3 + Math.random() * 0.7;

					data[idx] = Math.floor(r * noise);     // R
					data[idx + 1] = Math.floor(g * noise); // G
					data[idx + 2] = Math.floor(b * noise); // B
					data[idx + 3] = 255;                   // A (fully opaque)
				}
			}

			this._ctx.putImageData(imageData, 0, visibleTop);
		}
	}

	dispose(): void {
		this._disposed = true;
		this._stopAnimation();
	}
}

/**
 * Editor contribution that manages gutter decorations for Quarto cell execution state.
 * Shows visual indicators for cells that are queued or currently running.
 */
export class QuartoExecutionDecorations extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoExecutionDecorations';

	private _decorationsCollection: IEditorDecorationsCollection | undefined;
	private readonly _disposables = this._register(new DisposableStore());
	private _noiseOverlay: RunningCellNoiseOverlay | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IThemeService private readonly _themeService: IThemeService,
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
		// Clean up previous decorations and overlay
		this._disposables.clear();
		this._decorationsCollection?.clear();
		this._decorationsCollection = undefined;

		if (this._noiseOverlay) {
			this._editor.removeOverlayWidget(this._noiseOverlay);
			this._noiseOverlay.dispose();
			this._noiseOverlay = undefined;
		}

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

		// Create and add the noise overlay widget
		this._noiseOverlay = new RunningCellNoiseOverlay(this._editor, this._themeService);
		this._editor.addOverlayWidget(this._noiseOverlay);

		// Listen for execution state changes
		this._disposables.add(this._executionManager.onDidChangeExecutionState(() => {
			this._updateDecorations();
		}));

		// Listen for document content changes
		this._disposables.add(model.onDidChangeContent(() => {
			this._updateDecorations();
		}));

		// Listen for scroll changes to update the noise overlay position
		this._disposables.add(this._editor.onDidScrollChange(() => {
			// The overlay will handle scrolling in its render loop
		}));

		// Listen for layout changes
		this._disposables.add(this._editor.onDidLayoutChange(() => {
			if (this._noiseOverlay) {
				this._editor.layoutOverlayWidget(this._noiseOverlay);
			}
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
		const runningRanges: Array<{ startLine: number; endLine: number }> = [];

		for (const cell of cells) {
			const state = this._executionManager.getExecutionState(cell.id);

			if (state === CellExecutionState.Queued) {
				// For queued cells, create separate decorations for first/middle/last lines
				// to form a hollow rectangle spanning the entire cell
				const lineCount = cell.endLine - cell.startLine + 1;

				if (lineCount === 1) {
					// Single line - use all borders
					decorations.push({
						range: new Range(cell.startLine, 1, cell.startLine, 1),
						options: queuedSingleLineDecorationOptions,
					});
				} else {
					// First line - top + left/right borders
					decorations.push({
						range: new Range(cell.startLine, 1, cell.startLine, 1),
						options: queuedFirstLineDecorationOptions,
					});

					// Middle lines - left/right borders only
					if (lineCount > 2) {
						decorations.push({
							range: new Range(cell.startLine + 1, 1, cell.endLine - 1, 1),
							options: queuedDecorationOptions,
						});
					}

					// Last line - bottom + left/right borders
					decorations.push({
						range: new Range(cell.endLine, 1, cell.endLine, 1),
						options: queuedLastLineDecorationOptions,
					});
				}
			} else if (state === CellExecutionState.Running) {
				// Still add the decoration for overview ruler and tooltip
				decorations.push({
					range: new Range(cell.startLine, 1, cell.endLine, 1),
					options: runningDecorationOptions,
				});
				// Track the running range for the noise overlay
				runningRanges.push({
					startLine: cell.startLine,
					endLine: cell.endLine,
				});
			}
		}

		this._decorationsCollection.set(decorations);

		// Update the noise overlay with running ranges
		if (this._noiseOverlay) {
			this._noiseOverlay.setRunningRanges(runningRanges);
		}
	}

	override dispose(): void {
		if (this._noiseOverlay) {
			this._editor.removeOverlayWidget(this._noiseOverlay);
			this._noiseOverlay.dispose();
			this._noiseOverlay = undefined;
		}
		this._decorationsCollection?.clear();
		super.dispose();
	}
}
