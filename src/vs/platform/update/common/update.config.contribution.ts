/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb, isWindows } from '../../../base/common/platform.js';
import { PolicyCategory } from '../../../base/common/policy.js';
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
				category: PolicyCategory.Update,
				minimumVersion: '1.67',
				localization: {
					description: { key: 'updateMode', value: localize('updateMode', "Configure whether you receive automatic updates. Requires a restart after change. The updates are fetched from a Microsoft online service."), },
					enumDescriptions: [
						{
							key: 'none',
							value: localize('none', "Disable updates."),
						},
						{
							key: 'manual',
							value: localize('manual', "Disable automatic background update checks. Updates will be available if you manually check for updates."),
						},
						{
							key: 'start',
							value: localize('start', "Check for updates only on startup. Disable automatic background update checks."),
						},
						{
							key: 'default',
							value: localize('default', "Enable automatic update checks. Code will check for updates automatically and periodically."),
						}
					]
				},
			}
		},
		'update.autoUpdate': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('autoUpdateEnable', "Enable automatic updates. Requires a restart after change to take effect."),
			tags: ['usesOnlineServices'],
			included: (isWindows || isMacintosh) && !isWeb
		},
		'update.channel': {
			type: 'string',
			default: 'default',
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateMode', "Configure whether you receive automatic updates. Requires a restart after change to take effect."),
			deprecationMessage: localize('deprecated', "This setting is deprecated, please use '{0}' instead.", 'update.mode')
		},
		'update.positron.channel': {
			type: 'string',
			default: 'releases',
			enum: ['dailies', 'releases'],
			enumDescriptions: [
				localize('dailies', "The latest daily build. This is the most up-to-date version of Positron."),
				localize('releases', "Receive stable releases only."),
			],
			scope: ConfigurationScope.APPLICATION,
			description: localize('update.positron.channel', "Configure the release stream for receiving updates. Requires a restart after change to take effect."),
			tags: ['usesOnlineServices'],
			included: !isWeb
		},
		'update.primaryLanguageReporting': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('update.primaryLanguageReporting', "Share the primary data science languages in use, such as Python and R, to help us improve Positron."),
			tags: ['usesOnlineServices'],
			included: !isWeb
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
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('showReleaseNotes', "Show Release Notes after an update."),
			tags: ['usesOnlineServices'],
		},
		'update.systemArchitecture': {
			type: 'string',
			enum: ['auto', 'universal', 'x64', 'arm64'],
			default: 'auto',
			scope: ConfigurationScope.APPLICATION,
			description: localize('systemArchitecture', "Configure the system architecture for macOS updates."),
			included: isMacintosh && !isWeb,
			enumDescriptions: [
				localize('auto', "Automatically select the correct architecture"),
				localize('universal', "Universal binary for macOS, supporting both Intel and Apple Silicon"),
				localize('x64', "64-bit binary for Intel Macs"),
				localize('arm64', "arm64 binary for Apple Silicon Macs")
			]
		}
	}
	// --- End Positron ---
});
