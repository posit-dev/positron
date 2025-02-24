/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { positronConfigurationNodeBase } from '../../languageRuntime/common/languageRuntime.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

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
			default: true,
			markdownDescription: localize(
				'positron.enableConnectionsPane',
				'Enables the new Positron Connections Pane. Please restart Positron if you change this option.'
			),
		},
	},
});
