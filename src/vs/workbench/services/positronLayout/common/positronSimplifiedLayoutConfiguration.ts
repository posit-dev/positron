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
 * Turns on the simplified UI from the 2026 UI revamp spike: the Simplified layout preset,
 * the hidden bottom panel views and activity bar items, Help and Viewer that only show when
 * they have content, and the VS Code title bar in place of the top action bar.
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

/**
 * View containers the simplified layout removes from the UI: the bottom panel's Problems,
 * Output, Debug Console, and Ports, and the activity bar's Run and Debug, Remote Explorer,
 * and Testing.
 */
export const SIMPLIFIED_LAYOUT_HIDDEN_VIEW_CONTAINER_IDS: ReadonlySet<string> = new Set([
	'workbench.panel.markers',
	'workbench.panel.output',
	'workbench.panel.repl',
	'~remote.forwardedPortsContainer',
	'workbench.view.debug',
	'workbench.view.remote',
	'workbench.view.extension.test',
]);

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
				"Use the simplified layout: no bottom panel, the console, terminal, variables, and plots stacked in the secondary side bar, fewer views, and a single title bar. Takes effect after a reload."
			),
		},
	},
});
