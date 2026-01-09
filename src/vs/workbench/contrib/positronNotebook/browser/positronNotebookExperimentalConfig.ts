/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

// Configuration key for the Positron notebook setting
export const POSITRON_NOTEBOOK_ENABLED_KEY = 'positron.notebook.enabled';

// Configuration key for assistant auto-follow setting
export const POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY = 'positron.notebook.assistant.autoFollow';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * the Positron Notebook editor.
 * @param configurationService The configuration service
 * @returns Whether to enable the Positron Notebook editor
 */
export function checkPositronNotebookEnabled(
	configurationService: IConfigurationService
): boolean {
	return Boolean(
		configurationService.getValue(POSITRON_NOTEBOOK_ENABLED_KEY)
	);
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	id: 'positron',
	order: 7,
	title: localize('positronConfigurationTitle', "Positron"),
	type: 'object',
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[POSITRON_NOTEBOOK_ENABLED_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.enablePositronNotebook',
				'Enable the Positron Notebook editor for .ipynb files. When disabled, the default VS Code notebook editor will be used.\n\nA restart is required to take effect.'
			),
		},
		[POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'positron.notebook.assistant.autoFollow',
				'Automatically scroll to cells modified by the AI assistant. When enabled, cells modified outside the viewport will be automatically scrolled into view and highlighted.'
			),
		},
	},
});
