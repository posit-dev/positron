/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';

/**
 * Turns on the simplified UI from the 2026 UI revamp spike: task layouts that each show
 * only the views their work needs, Help and Viewer that only show when they have content, and the VS Code title bar in place of the top action bar.
 *
 * Read once at startup by each part of the UI it changes.
 */
export const SIMPLIFIED_LAYOUT_ENABLED_KEY = 'workbench.experimental.simplifiedLayout';

/**
 * Whether the simplified layout setting is on.
 */
export function isSimplifiedLayoutEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(SIMPLIFIED_LAYOUT_ENABLED_KEY) === true;
}

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[SIMPLIFIED_LAYOUT_ENABLED_KEY]: {
			type: 'boolean',
			default: true,
			// User settings only: on Positron Web, workspace settings load after the
			// layout reads this value, which would leave half of each UI on screen.
			scope: ConfigurationScope.APPLICATION,
			tags: ['experimental'],
			markdownDescription: localize(
				'positron.workbench.experimental.simplifiedLayout',
				"Use the simplified layout: task layouts that each show only the views their work needs, the console, terminal, variables, and plots stacked in the secondary side bar, and a single title bar. Takes effect after a reload."
			),
		},
	},
});
