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
import { positronConfigurationNodeBase } from '../../languageRuntime/common/languageRuntime.js';

// Key for the configuration setting
export const DATA_EXPLORER_CONVERT_TO_CODE =
	'dataExplorer.convertToCode';


/**
 * 	Retrieves the value of the configuration setting that determines whether to enable
 *  the convert to code feature in the Positron Data Explorer.
 * @param configurationService The configuration service
 * @returns Whether to enable the convert to code feature in the Positron Data Explorer
 */
export function checkDataExplorerConvertToCodeEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(DATA_EXPLORER_CONVERT_TO_CODE)
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
		[DATA_EXPLORER_CONVERT_TO_CODE]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.dataExplorer.convertToCode',
				'**CAUTION**: Enable experimental Data Explorer "Convert to Code" feature. This feature is experimental and may not work as expected. Use at your own risk.'
			),
		},
	},
});
