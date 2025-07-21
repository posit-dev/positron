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
export const USE_DATA_EXPLORER_SUMMARY_PANEL_ENHANCEMENTS_KEY =
	'dataExplorer.summaryPanelEnhancements';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * the data explorer summary panel enhancements feature.
 * @param configurationService The configuration service
 * @returns Whether to enablet the summary panel enhancements feature
 */
export function summaryPanelEnhancementsFeatureEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(USE_DATA_EXPLORER_SUMMARY_PANEL_ENHANCEMENTS_KEY)
	);
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	properties: {
		[USE_DATA_EXPLORER_SUMMARY_PANEL_ENHANCEMENTS_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.enableSummaryPanelEnhancementsFeatures',
				'**CAUTION**: Enable experimental Data Explorer Summary Panel enhancement features which may result in unexpected behaviour. Please restart Positron if you change this option.'
			),
		},
	},
});
