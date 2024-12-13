/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { positronConfigurationNodeBase } from 'vs/workbench/services/languageRuntime/common/languageRuntime';

const POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY = 'positron.runtimeNotebookKernel.enable';

/**
 * Check whether runtime notebook kernels are enabled.
 */
export function isRuntimeNotebookKernelEnabled(configurationService: IConfigurationService) {
	return configurationService.getValue<boolean>(POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY);
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.runtimeNotebookKernel.enable.description',
				'**CAUTION**: Enable experimental runtime notebook kernels which may result in unexpected behaviour. Requires a restart to take effect.'
			),
		},
	},
});
