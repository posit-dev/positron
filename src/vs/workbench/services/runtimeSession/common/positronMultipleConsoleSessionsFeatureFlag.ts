/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { positronConfigurationNodeBase } from '../../languageRuntime/common/languageRuntime.js';

// Key for the multiple sessions setting
export const USE_POSITRON_MULTIPLE_CONSOLE_SESSIONS_CONFIG_KEY =
	'console.multipleConsoleSessions';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * multiple sessions feature.
 * @param configurationService The configuration service
 * @returns Whether to enablet the multiple sessions feature
 */
export function multipleConsoleSessionsFeatureEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(USE_POSITRON_MULTIPLE_CONSOLE_SESSIONS_CONFIG_KEY)
	);
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	properties: {
		[USE_POSITRON_MULTIPLE_CONSOLE_SESSIONS_CONFIG_KEY]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize(
				'console.enableMultipleConsoleSessionsFeature',
				'**CAUTION**: Enable experimental Positron multiple console sessions features which may result in unexpected behaviour. Please restart Positron if you change this option.'
			),
		},
	},
});
