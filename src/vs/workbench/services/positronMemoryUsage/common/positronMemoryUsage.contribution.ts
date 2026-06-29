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
			'memoryUsage.enabled': {
				type: 'boolean',
				default: true,
				markdownDescription: localize('positron.memoryUsage.enabled', "Whether to display memory usage in the Variables pane. When disabled, memory polling is stopped and the memory meter is hidden."),
			},
			'memoryUsage.pollingIntervalMs': {
				type: 'number',
				default: 10000,
				minimum: 500,
				maximum: 60000,
				markdownDescription: localize('positron.memoryUsage.pollingIntervalMs', "How often to poll for system memory usage, in milliseconds."),
			},
			'memoryUsage.lowMemoryThresholdPercent': {
				type: 'number',
				default: 5,
				minimum: 0,
				maximum: 100,
				markdownDescription: localize('positron.memoryUsage.lowMemoryThresholdPercent', "Show a low-memory warning in the Variables pane when free system memory drops to or below this percentage of total memory. Set to `0` to disable."),
			},
			'memoryUsage.lowMemoryThresholdMB': {
				type: 'number',
				default: 0,
				minimum: 0,
				markdownDescription: localize('positron.memoryUsage.lowMemoryThresholdMB', "Show a low-memory warning in the Variables pane when free system memory drops to or below this number of megabytes. Set to `0` to disable."),
			},
			'memoryUsage.lowMemoryNotification': {
				type: 'boolean',
				default: true,
				markdownDescription: localize('positron.memoryUsage.lowMemoryNotification', "Whether to show a notification when the system enters a low-memory state. The notification appears at most once per session."),
			}
		}
	});
