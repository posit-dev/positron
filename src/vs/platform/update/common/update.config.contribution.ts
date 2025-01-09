/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb, isWindows } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../configuration/common/configurationRegistry.js';
import { Registry } from '../../registry/common/platform.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
// --- Start Positron ---
configurationRegistry.registerConfiguration({
	id: 'update',
	order: 15,
	title: localize('updateConfigurationTitle', "Update"),
	type: 'object',
	properties: {
		'update.mode': {
			type: 'string',
			enum: ['none', 'manual', 'start', 'default'],
			default: 'default',
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateMode', "Configure whether you receive automatic updates. Requires a restart after change to take effect."),
			tags: ['usesOnlineServices'],
			enumDescriptions: [
				localize('none', "Disable updates."),
				localize('manual', "Disable automatic background update checks. Updates will be available if you manually check for updates."),
				localize('start', "Check for updates only on startup. Disable automatic background update checks."),
				localize('default', "Enable automatic update checks. Code will check for updates automatically and periodically.")
			],
			policy: {
				name: 'UpdateMode',
				minimumVersion: '2025.1.0',
			}
		},
		'update.autoUpdateExperimental': {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('experimentalAutoUpdate', "CAUTION: Enable automatic update checking. Requires a restart after change to take effect."),
			tags: ['usesOnlineServices'],
		},
		'update.channel': {
			type: 'string',
			default: 'default',
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateMode', "Configure whether you receive automatic updates. Requires a restart after change to take effect."),
			deprecationMessage: localize('deprecated', "This setting is deprecated, please use '{0}' instead.", 'update.mode')
		},
		'update.enableWindowsBackgroundUpdates': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			title: localize('enableWindowsBackgroundUpdatesTitle', "Enable Background Updates on Windows"),
			description: localize('enableWindowsBackgroundUpdates', "Enable to download and install new VS Code versions in the background on Windows."),
			included: isWindows && !isWeb
		},
		'update.showReleaseNotes': {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			description: localize('showReleaseNotes', "Show Release Notes after an update."),
			tags: ['usesOnlineServices'],
			included: false
		}
	}
	// --- End Positron ---
});
