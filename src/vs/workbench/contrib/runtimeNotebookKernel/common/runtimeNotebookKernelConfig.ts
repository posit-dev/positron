/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { positronConfigurationNodeBase } from '../../../services/languageRuntime/common/languageRuntime.js';

export const POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY = 'positron.runtimeNotebookKernel.enable';
export const NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY = 'notebook.experimental.showExecutionInfo';

/**
 * The extension ID used by Positron runtime notebook kernels.
 *
 * Although runtime notebook kernels live in the main thread, some notebook services still expect it
 * to have an extension ID.
 */
export const POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID = 'positron.runtime-notebook-kernels';

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
			default: true,
			markdownDescription: localize(
				'positron.runtimeNotebookKernel.enable.description',
				'Enable runtime notebook kernels which live in the main thread instead of in the extension host. Requires a restart to take effect.'
			),
		},
		[NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY]: {
			type: 'boolean',
			default: false,
			description: localize(
				'notebook.experimental.showExecutionInfo.description',
				'Show notebook execution information in the status bar, such as the total duration and number of cells executed.',
			),
		}
	},
});
