/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import * as nls from '../../../../nls.js';
import { positronConfigurationNodeBase } from '../../../services/languageRuntime/common/languageRuntime.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);

configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	properties: {
		'positron.r.autoConvertFilePaths': {
			scope: ConfigurationScope.MACHINE_OVERRIDABLE,
			type: 'boolean',
			default: true,
			description: nls.localize(
				'positron.r.autoConvertFilePaths',
				'Automatically convert file paths when pasting files into R contexts (matches RStudio behavior)'
			),
		},
	}
});