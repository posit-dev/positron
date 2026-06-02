/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { LanguageSelector } from '../../../../editor/common/languageSelector.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { QUARTO_CELL_SCHEME, QUARTO_LANGUAGE_IDS, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoCellModelService, QuartoCellModelService } from './quartoCellModelService.js';
import { QuartoCompletionProvider } from './quartoCompletionProvider.js';

/**
 * Wires up Positron's language features for the code chunks of Quarto
 * documents:
 * - registers the completion provider that forwards in-chunk requests to the
 *   per-language servers, and
 * - keeps a synthetic cell model in sync for every open Quarto document, so the
 *   servers see the chunk content as open documents.
 */
class QuartoLanguageFeaturesContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoLanguageFeatures';

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoCellModelService private readonly _cellModelService: IQuartoCellModelService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		// One completion provider serves every Quarto/RMarkdown language id.
		const selector: LanguageSelector = QUARTO_LANGUAGE_IDS.map(language => ({ language }));
		const provider = instantiationService.createInstance(QuartoCompletionProvider);
		this._register(languageFeaturesService.completionProvider.register(selector, provider));

		// Sync cell models for documents that are already open, then track changes.
		for (const model of this._modelService.getModels()) {
			this._ensureSync(model);
		}
		this._register(this._modelService.onModelAdded(model => this._ensureSync(model)));
		this._register(this._modelService.onModelLanguageChanged(e => this._ensureSync(e.model)));
		this._register(this._modelService.onModelRemoved(model => this._cellModelService.disposeSync(model.uri)));
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
		this._cellModelService.ensureSync(this._documentModelService.getModel(model));
	}
}

registerSingleton(IQuartoCellModelService, QuartoCellModelService, InstantiationType.Delayed);

registerWorkbenchContribution2(
	QuartoLanguageFeaturesContribution.ID,
	QuartoLanguageFeaturesContribution,
	WorkbenchPhase.AfterRestored,
);
