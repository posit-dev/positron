/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
 * Decoration options for queued cells.
 */
const queuedDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-queued-execution',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-queued',
	linesDecorationsTooltip: localize('quartoQueued', 'Queued for execution'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		color: themeColorFromId(quartoExecutionQueued),
		position: OverviewRulerLane.Left,
	},
};

/**
 * Decoration options for running cells.
 */
const runningDecorationOptions: IModelDecorationOptions = {
	description: 'quarto-running-execution',
	isWholeLine: true,
	linesDecorationsClassName: 'quarto-execution-running',
	linesDecorationsTooltip: localize('quartoRunning', 'Currently executing'),
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	overviewRuler: {
		color: themeColorFromId(quartoExecutionRunning),
		position: OverviewRulerLane.Left,
	},
};

/**
 * Editor contribution that manages gutter decorations for Quarto cell execution state.
 * Shows visual indicators for cells that are queued or currently running.
 */
export class QuartoExecutionDecorations extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoExecutionDecorations';

	private _decorationsCollection: IEditorDecorationsCollection | undefined;
	private readonly _disposables = this._register(new DisposableStore());

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

		for (const cell of cells) {
			const state = this._executionManager.getExecutionState(cell.id);

			if (state === CellExecutionState.Queued) {
				decorations.push({
					range: new Range(cell.startLine, 1, cell.endLine, 1),
					options: queuedDecorationOptions,
				});
			} else if (state === CellExecutionState.Running) {
				decorations.push({
					range: new Range(cell.startLine, 1, cell.endLine, 1),
					options: runningDecorationOptions,
				});
			}
		}

		this._decorationsCollection.set(decorations);
	}

	override dispose(): void {
		this._decorationsCollection?.clear();
		super.dispose();
	}
}
