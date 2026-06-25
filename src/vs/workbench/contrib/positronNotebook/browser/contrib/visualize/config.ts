/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';
import { Action2, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { IHeadlessLanguageModelService } from '../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { showHeadlessModelPicker } from '../../../../../services/positronHeadlessLanguageModel/browser/headlessModelPicker.js';

// Configuration key for the visualize suggestion model patterns.
export const VISUALIZE_MODEL_KEY = 'positron.assistant.notebook.visualize.model';

// Command ID for selecting the visualize model.
export const SELECT_VISUALIZE_MODEL_COMMAND_ID = 'positronNotebook.selectVisualizeModel';

// Register visualize configuration.
const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'positron.notebookVisualize',
	order: 8,
	title: localize('positronNotebookVisualizeConfigurationTitle', "Positron Notebook Visualize"),
	type: 'object',
	properties: {
		[VISUALIZE_MODEL_KEY]: {
			type: 'array',
			items: { type: 'string' },
			// Empty by default so the displayed default matches the runtime
			// behavior: an empty/unset value uses the configurable fast/cheap
			// tier (see intentFromSetting). A non-empty value pins specific
			// patterns instead and bypasses that tier.
			default: [],
			markdownDescription: localize(
				'positron.assistant.notebook.visualize.model',
				'Model patterns for AI visualization suggestions. [Select a model](command:positronNotebook.selectVisualizeModel) or specify patterns manually. Patterns are tried in order until one matches an available model (case-insensitive). When left empty, the default fast/cheap tier is used.'
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['experimental', 'positronNotebook'],
		},
	},
});

// Select the model used for visualization suggestions, via the reusable picker.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SELECT_VISUALIZE_MODEL_COMMAND_ID,
			title: localize2('positronNotebook.selectVisualizeModel', 'Select Visualize Model'),
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
				settingKey: VISUALIZE_MODEL_KEY,
				title: localize('positronNotebook.selectVisualizeModel.title', "Select Model for Visualizations"),
			},
		);
	}
});
