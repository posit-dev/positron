/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { positronConfigurationNodeBase } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const POSITRON_CONNECTIONS_VIEW_ENABLED = new RawContextKey<boolean>(
	'positronConnectionsViewEnabled',
	false
);

// Key for the configuration setting
export const USE_POSITRON_CONNECTIONS_KEY =
	'positron.connections';

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);

configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_POSITRON_CONNECTIONS_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.enableConnectionsPane',
				'**CAUTION**: Enable experimental Positron Connections Pane features which may result in unexpected behaviour. Please restart Positron if you change this option.'
			),
		},
	},
});
