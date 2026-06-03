/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { LanguageSelector } from '../../../../editor/common/languageSelector.js';
import { IMarkerService } from '../../../../platform/markers/common/markers.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { QUARTO_CELL_SCHEME, QUARTO_LANGUAGE_IDS, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoCellModelService, QuartoCellModelService } from './quartoCellModelService.js';
import { QuartoCompletionProvider } from './quartoCompletionProvider.js';
import { QuartoCodeActionProvider } from './quartoCodeActionProvider.js';
import { QuartoCellDiagnostics } from './quartoCellDiagnostics.js';

/**
 * Wires up Positron's language features for the code chunks of Quarto
 * documents:
 * - keeps a synthetic cell model in sync for every open Quarto document, so the
 *   servers see the chunk content as open documents
 * - registers the providers that forward in-chunk requests to the per-language
 *   servers (completion, code-action, etc)
 * - re-projects the diagnostics the servers publish against those cell models
 *   back onto the host `.qmd` document
 */
class QuartoLanguageFeaturesContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoLanguageFeatures';

	// Per-document diagnostics re-projectors, keyed by document uri string.
	private readonly _diagnostics = this._register(new DisposableMap<string, QuartoCellDiagnostics>());

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoCellModelService private readonly _cellModelService: IQuartoCellModelService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		// One set of bridge providers serves every Quarto/RMarkdown language id.
		const selector: LanguageSelector = QUARTO_LANGUAGE_IDS.map(language => ({ language }));
		this._register(languageFeaturesService.completionProvider.register(
			selector, instantiationService.createInstance(QuartoCompletionProvider)));
		this._register(languageFeaturesService.codeActionProvider.register(
			selector, instantiationService.createInstance(QuartoCodeActionProvider)));

		// Sync models for documents that are already open, then track changes.
		for (const model of this._modelService.getModels()) {
			this._ensureSync(model);
		}
		this._register(this._modelService.onModelAdded(model => this._ensureSync(model)));
		this._register(this._modelService.onModelLanguageChanged(e => this._ensureSync(e.model)));
		this._register(this._modelService.onModelRemoved(model => {
			this._cellModelService.disposeSync(model.uri);
			this._diagnostics.deleteAndDispose(model.uri.toString());
		}));
	}

	private _ensureSync(model: ITextModel): void {
		// Skip our own synthetic cell models: they reuse the host document's path
		// (which ends in .qmd) and would otherwise match isQuartoDocument and
		// recurse.
		if (model.uri.scheme === QUARTO_CELL_SCHEME) {
			return;
		}
		if (!isQuartoDocument(model.uri.path, model.getLanguageId())) {
			return;
		}
		const documentModel = this._documentModelService.getModel(model);

		// Ensure a cell model sync exists for this document model
		this._cellModelService.ensureSync(documentModel);

		// Re-project the chunk diagnostics for this document onto the `.qmd`.
		const key = model.uri.toString();
		if (!this._diagnostics.has(key)) {
			this._diagnostics.set(key, new QuartoCellDiagnostics(documentModel, this._cellModelService, this._markerService));
		}
	}
}

registerSingleton(IQuartoCellModelService, QuartoCellModelService, InstantiationType.Delayed);

registerWorkbenchContribution2(
	QuartoLanguageFeaturesContribution.ID,
	QuartoLanguageFeaturesContribution,
	WorkbenchPhase.AfterRestored,
);
