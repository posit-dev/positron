/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/** Turns the agent features of the Checkpoints view on or off. `ai.enabled` must also be true. */
export const CHECKPOINTS_SUGGESTIONS_ENABLED_KEY = 'versionHistory.suggestions.enabled';

/** Model name patterns for the agent features of the Checkpoints view. */
export const CHECKPOINTS_MODEL_KEY = 'versionHistory.model';

/** Minutes between background checks of the shared copy. Zero turns background checks off. */
export const CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY = 'versionHistory.checkSharedInterval';

/** Registers the Checkpoints settings. */
export function registerCheckpointsConfiguration(): void {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
		id: 'checkpoints',
		order: 9,
		title: localize('positron.checkpoints.configuration.title', "Version History"),
		type: 'object',
		properties: {
			[CHECKPOINTS_SUGGESTIONS_ENABLED_KEY]: {
				type: 'boolean',
				default: true,
				description: localize(
					'positron.checkpoints.configuration.suggestions.enabled',
					"Enable the AI-assisted features of the Version History view, such as descriptions of your changes and suggested versions."
				),
				scope: ConfigurationScope.WINDOW,
				order: 1,
			},
			[CHECKPOINTS_MODEL_KEY]: {
				type: 'array',
				items: { type: 'string' },
				default: [],
				markdownDescription: localize(
					'positron.checkpoints.configuration.model',
					"Model patterns for the suggestions of the Version History view. Patterns are tried in order until one matches an available model (case-insensitive). When left empty, the default fast tier is used."
				),
				scope: ConfigurationScope.WINDOW,
				order: 2,
			},
			[CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY]: {
				type: 'number',
				default: 5,
				minimum: 0,
				description: localize(
					'positron.checkpoints.configuration.checkSharedInterval',
					"Minutes between background checks of the shared copy. A fraction is allowed, and the shortest time is 5 seconds. Set to 0 to turn background checks off."
				),
				scope: ConfigurationScope.WINDOW,
				order: 3,
			},
		},
	});
}
