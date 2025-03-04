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
import { PositronDataExplorerLayout } from './interfaces/positronDataExplorerService.js';

// Key for the configuration setting
export const USE_POSITRON_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY =
	'positron.dataExplorerSummaryCollapsed';
export const USE_POSITRON_DATA_EXPLORER_SUMMARY_LAYOUT_KEY =
	'positron.dataExplorerSummaryLayout';

export function DataExplorerSummaryCollapseEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(USE_POSITRON_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY)
	);
}

export function DefaultDataExplorerSummaryLayout(
	configurationService: IConfigurationService
) {
	if (String(
		configurationService.getValue(USE_POSITRON_DATA_EXPLORER_SUMMARY_LAYOUT_KEY)
	) === 'left') {
		return PositronDataExplorerLayout.SummaryOnLeft;
	} else {
		return PositronDataExplorerLayout.SummaryOnRight;
	}
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({ // for summary collapse
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_POSITRON_DATA_EXPLORER_SUMMARY_COLLAPSED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.enablePositronDataExplorerSummaryCollapse',
				'Collapse Data Explorer Summary Panel by default.'
			),
		},
	},
});
configurationRegistry.registerConfiguration({ // for summary layout
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_POSITRON_DATA_EXPLORER_SUMMARY_LAYOUT_KEY]: {
			type: 'string',
			default: 'left', // Default value (can be "left" or "right")
			enum: ['left', 'right'], // Define possible values
			markdownDescription: localize(
				'positron.dataExplorerSummaryLayout',
				'Select the position of the Data Explorer Summary Panel (left or right).'
			),
		},
	},
});
