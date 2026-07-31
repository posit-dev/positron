/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { LanguageSelector } from '../../../../editor/common/languageSelector.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { QUARTO_LANGUAGE_IDS } from '../common/positronQuartoConfig.js';
import { QuartoShadowLanguageBridge } from './quartoShadowLanguageBridge.js';
import { QuartoShadowCompletionProvider } from './quartoShadowCompletionProvider.js';
import { QuartoShadowCodeActionProvider } from './quartoShadowCodeActionProvider.js';
import {
	QuartoShadowDefinitionProvider,
	QuartoShadowDocumentHighlightProvider,
	QuartoShadowHoverProvider,
	QuartoShadowReferenceProvider,
	QuartoShadowSignatureHelpProvider,
} from './quartoShadowLanguageFeatureProviders.js';

/**
 * Registers the shadow bridge providers that surface real language features
 * (completions, hover, etc.) inside `.qmd`/`.Rmd` editors by forwarding
 * in-cell requests to the language servers via the shadow notebook's cell
 * models.
 *
 * Registration is unconditional for the Quarto/R Markdown language ids; the
 * `quarto.shadowNotebook.enabled` setting is read live per request by the
 * bridge, so toggling it takes effect immediately without churning provider
 * registrations.
 */
class QuartoShadowLanguageFeaturesContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.quartoShadowLanguageFeatures';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		// One set of bridge providers serves every Quarto/R Markdown language id.
		const selector: LanguageSelector = QUARTO_LANGUAGE_IDS.map(language => ({ language }));
		const bridge = instantiationService.createInstance(QuartoShadowLanguageBridge);

		this._register(languageFeaturesService.completionProvider.register(
			selector, instantiationService.createInstance(QuartoShadowCompletionProvider, bridge)));
		this._register(languageFeaturesService.hoverProvider.register(
			selector, instantiationService.createInstance(QuartoShadowHoverProvider, bridge)));
		this._register(languageFeaturesService.signatureHelpProvider.register(
			selector, instantiationService.createInstance(QuartoShadowSignatureHelpProvider, bridge)));
		this._register(languageFeaturesService.definitionProvider.register(
			selector, instantiationService.createInstance(QuartoShadowDefinitionProvider, bridge)));
		this._register(languageFeaturesService.referenceProvider.register(
			selector, instantiationService.createInstance(QuartoShadowReferenceProvider, bridge)));
		this._register(languageFeaturesService.codeActionProvider.register(
			selector, instantiationService.createInstance(QuartoShadowCodeActionProvider, bridge)));
		this._register(languageFeaturesService.documentHighlightProvider.register(
			selector, instantiationService.createInstance(QuartoShadowDocumentHighlightProvider, bridge)));
	}
}

registerWorkbenchContribution2(
	QuartoShadowLanguageFeaturesContribution.ID,
	QuartoShadowLanguageFeaturesContribution,
	WorkbenchPhase.AfterRestored,
);
