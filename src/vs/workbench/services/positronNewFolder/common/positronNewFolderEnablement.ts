/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { positronConfigurationNodeBase } from '../../languageRuntime/common/languageRuntime.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';

// Key for the configuration setting
export const USE_POSITRON_NEW_FOLDER_FLOW_CONFIG_KEY = 'positron.work-In-ProgressNewFolderFlowFeatures';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * work-in-progress features in the New Folder Flow.
 * @param configurationService The configuration service
 * @returns Whether to enable work-in-progress New Folder Flow features
 */
export function newFolderFlowWorkInProgressEnabled(configurationService: IConfigurationService) {
	return Boolean(configurationService.getValue(USE_POSITRON_NEW_FOLDER_FLOW_CONFIG_KEY));
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_POSITRON_NEW_FOLDER_FLOW_CONFIG_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.enablePositronNewFolderFlowWorkInProgress',
				'**CAUTION**: Enable work-in-progress New Folder Flow features which may result in unexpected behaviour.'
			),
		},
	},
});
