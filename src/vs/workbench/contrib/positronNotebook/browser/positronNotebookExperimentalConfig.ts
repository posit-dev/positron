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
import { positronConfigurationNodeBase } from '../../../services/languageRuntime/common/languageRuntime.js';

// Key for the configuration setting (relative to positron configuration node)
export const POSITRON_NOTEBOOK_ENABLED_KEY = 'notebook.enabled';

// Full configuration path (for affectsConfiguration and external references)
export const POSITRON_NOTEBOOK_ENABLED_FULL_KEY = 'positron.notebook.enabled';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * the experimental Positron Notebook editor.
 * @param configurationService The configuration service
 * @returns Whether to enable the experimental Positron Notebook editor
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
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[POSITRON_NOTEBOOK_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			included: false, // Hide from Settings UI - can only be set directly in JSON
			tags: ['experimental'],
			markdownDescription: localize(
				'positron.enablePositronNotebook',
				'Enable the Positron Notebook editor for .ipynb files. When disabled, the default VS Code notebook editor will be used.\n\nA restart is required to take effect.'
			),
		},
	},
});
