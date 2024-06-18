/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { positronConfigurationNodeBase } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { SupportStatus } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

// Key for the configuration setting
export const USE_POSITRON_DATA_EXPLORER_EXPERIMENTAL_KEY =
	'positron.dataExplorerExperimental';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * experimental features in the Positron Data Explorer.
 * @param configurationService The configuration service
 * @returns Whether to enable experimental Positron Data Explorer features
 */
export function checkDataExplorerExperimentalFeaturesEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(USE_POSITRON_DATA_EXPLORER_EXPERIMENTAL_KEY)
	);
}

export function dataExplorerExperimentalFeatureEnabled(
	status: SupportStatus,
	configurationService: IConfigurationService
) {
	if (status === SupportStatus.Supported) {
		return true;
	}

	if (status === SupportStatus.Experimental) {
		return checkDataExplorerExperimentalFeaturesEnabled(configurationService);
	}

	return false;
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_POSITRON_DATA_EXPLORER_EXPERIMENTAL_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.enablePositronDataExplorerExperimentalFeatures',
				'**CAUTION**: Enable experimental Positron Data Explorer features which may result in unexpected behaviour.'
			),
		},
	},
});
