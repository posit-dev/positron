/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';

// Register the configuration setting for memory usage polling interval.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		id: 'positronMemoryUsage',
		title: localize('positron.memoryUsage', "Memory Usage"),
		properties: {
			'positron.memoryUsage.enabled': {
				type: 'boolean',
				default: true,
				markdownDescription: localize('positron.memoryUsage.enabled', "Whether to display memory usage in the Variables pane. When disabled, memory polling is stopped and the memory meter is hidden."),
			},
			'positron.memoryUsage.pollingIntervalMs': {
				type: 'number',
				default: 10000,
				minimum: 500,
				maximum: 60000,
				markdownDescription: localize('positron.memoryUsage.pollingIntervalMs', "How often to poll for system memory usage, in milliseconds."),
			}
		}
	});
