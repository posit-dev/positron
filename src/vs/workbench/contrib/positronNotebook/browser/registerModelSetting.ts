/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2, ILocalizedString } from '../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IHeadlessLanguageModelService } from '../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { showHeadlessModelPicker } from '../../../services/positronHeadlessLanguageModel/browser/headlessModelPicker.js';

/** A notebook AI feature's model-pattern setting and its picker command. */
export interface INotebookModelSetting {
	/** The configuration container id, e.g. `positron.notebookSuggestions`. */
	readonly configId: string;
	/** The localized container title shown in the settings editor. */
	readonly title: string;
	/** The setting key, e.g. `positron.assistant.notebook.suggestions.model`. */
	readonly settingKey: string;
	/** The localized markdown description for the setting. */
	readonly description: string;
	/** The command id that opens the model picker for this setting. */
	readonly commandId: string;
	/** The localized command title (from `localize2`). */
	readonly commandTitle: ILocalizedString;
	/** The localized quick-pick title for the picker. */
	readonly pickerTitle: string;
}

/**
 * Register the array-of-patterns model setting and the "Select Model" command a
 * notebook AI feature needs. Every notebook model setting shares the same shape
 * -- a WINDOW-scoped string array, empty by default, plus a palette command that
 * opens the shared {@link showHeadlessModelPicker} -- so consumers describe only
 * what differs (ids, titles, description) and this owns the registration.
 *
 * The default is empty so the displayed default matches the runtime behavior: an
 * empty/unset value uses the configurable fast/cheap tier (see
 * `intentFromSetting`); a non-empty value pins specific patterns and bypasses it.
 */
export function registerNotebookModelSetting(setting: INotebookModelSetting): void {
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
		id: setting.configId,
		order: 8,
		title: setting.title,
		type: 'object',
		properties: {
			[setting.settingKey]: {
				type: 'array',
				items: { type: 'string' },
				default: [],
				markdownDescription: setting.description,
				scope: ConfigurationScope.WINDOW,
				tags: ['experimental', 'positronNotebook'],
			},
		},
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: setting.commandId,
				title: setting.commandTitle,
				f1: true,
				category: localize2('positronNotebook.category', 'Positron Notebook'),
			});
		}

		override async run(accessor: ServicesAccessor): Promise<void> {
			await showHeadlessModelPicker(
				accessor.get(IHeadlessLanguageModelService),
				accessor.get(IQuickInputService),
				accessor.get(IConfigurationService),
				{ settingKey: setting.settingKey, title: setting.pickerTitle },
			);
		}
	});
}
