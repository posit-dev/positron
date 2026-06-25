/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IHeadlessLanguageModelService } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { showHeadlessModelPicker } from '../../../../services/positronHeadlessLanguageModel/browser/headlessModelPicker.js';

// Configuration key for notebook AI suggestion model patterns.
export const NOTEBOOK_SUGGESTIONS_MODEL_KEY = 'positron.assistant.notebook.suggestions.model';

// Command ID for selecting the notebook suggestions model.
export const SELECT_SUGGESTIONS_MODEL_COMMAND_ID = 'positronNotebook.selectSuggestionsModel';

// Register notebook suggestions configuration.
const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'positron.notebookSuggestions',
	order: 8,
	title: localize('positronNotebookSuggestionsConfigurationTitle', "Positron Notebook AI Suggestions"),
	type: 'object',
	properties: {
		[NOTEBOOK_SUGGESTIONS_MODEL_KEY]: {
			type: 'array',
			items: { type: 'string' },
			// Empty by default so the displayed default matches the runtime
			// behavior: an empty/unset value uses the configurable fast/cheap
			// tier (see intentFromSetting). A non-empty value pins specific
			// patterns instead and bypasses that tier.
			default: [],
			markdownDescription: localize(
				'positron.assistant.notebook.suggestions.model',
				'Model patterns for AI notebook suggestions. [Select a model](command:positronNotebook.selectSuggestionsModel) or specify patterns manually. Patterns are tried in order until one matches an available model (case-insensitive). When left empty, the default fast/cheap tier is used.'
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['experimental', 'positronNotebook'],
		},
	},
});

// Select the model used for notebook suggestions, via the reusable picker.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SELECT_SUGGESTIONS_MODEL_COMMAND_ID,
			title: localize2('positronNotebook.selectSuggestionsModel', 'Select Notebook Suggestions Model'),
			f1: true,
			category: localize2('positronNotebook.category', 'Positron Notebook'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await showHeadlessModelPicker(
			accessor.get(IHeadlessLanguageModelService),
			accessor.get(IQuickInputService),
			accessor.get(IConfigurationService),
			{
				settingKey: NOTEBOOK_SUGGESTIONS_MODEL_KEY,
				title: localize('positronNotebook.selectSuggestionsModel.title', "Select Model for Notebook Suggestions"),
			},
		);
	}
});
