/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';

export const POSITRON_REMOTE_SSH_EXPERIMENTAL_KEY =
	'positron.RemoteHostExperimental';

export function registerRemoteConfiguration() {
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	configurationRegistry.registerConfiguration({
		id: 'positron',
		properties: {
			[POSITRON_REMOTE_SSH_EXPERIMENTAL_KEY]: {
				scope: ConfigurationScope.MACHINE,
				type: 'boolean',
				default: false,
				markdownDescription: localize(
					'positron.enableRemoteSSHExperimentalFeatures',
					'Enable support for connecting to remote hosts over SSH.\n\n**CAUTION**: Support for Remote SSH is experimental; not all features work in a remote environment, and currently only Linux x86 remote hosts are supported.'
				),
			}
		}
	});
}
