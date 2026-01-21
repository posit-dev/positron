/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Range } from '../../../../editor/common/core/range.js';
import { CodeLens, CodeLensList, CodeLensProvider } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoExecutionManager, CellExecutionState } from '../common/quartoExecutionTypes.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY } from '../common/positronQuartoConfig.js';
import { QuartoCommandId } from './quartoCommands.js';

/**
 * CodeLens provider for Quarto code cells.
 * Provides Run Cell, Run Above, and Run Below actions for each code cell.
 */
export class QuartoCodeLensProvider extends Disposable implements CodeLensProvider {
	private readonly _onDidChange = this._register(new Emitter<this>());
	readonly onDidChange: Event<this> = this._onDidChange.event;

	constructor(
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();

		// Register for .qmd files
		this._register(this._languageFeaturesService.codeLensProvider.register(
			{ pattern: '**/*.qmd' },
			this
		));

		// Fire change events when execution state changes
		this._register(this._executionManager.onDidChangeExecutionState(() => {
			this._onDidChange.fire(this);
		}));

		// Fire change events when configuration changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				this._onDidChange.fire(this);
			}
		}));
	}

	provideCodeLenses(model: ITextModel): CodeLensList | undefined {
		// Check if feature is enabled
		const enabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
		if (!enabled) {
			return undefined;
		}

		// Check if this is a qmd file
		if (!model.uri.path.endsWith('.qmd')) {
			return undefined;
		}

		const store = new DisposableStore();
		const lenses: CodeLens[] = [];
		const lensList: CodeLensList = { lenses, dispose: () => store.dispose() };

		const quartoModel = this._documentModelService.getModel(model);
		const cells = quartoModel.cells;

		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];
			const range = Range.fromPositions({ lineNumber: cell.startLine, column: 1 });
			const executionState = this._executionManager.getExecutionState(cell.id);

			// Run Cell action with state indicator
			const runTitle = this._getRunCellTitle(executionState);
			lenses.push({
				range,
				command: {
					id: QuartoCommandId.RunCurrentCell,
					title: runTitle,
					arguments: [cell.startLine],
				},
			});

			// Run Above action (only if not the first cell)
			if (i > 0) {
				lenses.push({
					range,
					command: {
						id: QuartoCommandId.RunCellsAbove,
						title: localize('quarto.codelens.runAbove', 'Run Above'),
						arguments: [cell.startLine],
					},
				});
			}

			// Run Below action (only if not the last cell)
			if (i < cells.length - 1) {
				lenses.push({
					range,
					command: {
						id: QuartoCommandId.RunCellsBelow,
						title: localize('quarto.codelens.runBelow', 'Run Below'),
						arguments: [cell.startLine],
					},
				});
			}
		}

		return lensList;
	}

	/**
	 * Get the Run Cell title based on execution state.
	 */
	private _getRunCellTitle(state: CellExecutionState): string {
		switch (state) {
			case CellExecutionState.Running:
				return '$(loading~spin) ' + localize('quarto.codelens.running', 'Running');
			case CellExecutionState.Queued:
				return '$(clock) ' + localize('quarto.codelens.queued', 'Queued');
			default:
				return '$(run) ' + localize('quarto.codelens.runCell', 'Run Cell');
		}
	}
}
