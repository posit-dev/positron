/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Main switch for Positron's AI features. When off, all of Positron's AI
 * features (Next Edit Suggestions, notebook AI, console Fix/Explain, etc.) are
 * turned off.
 *
 * Owned by Positron. It sits above the Posit Assistant extension's
 * `assistant.enabled` (which controls the chat UI): Posit Assistant also reads
 * `ai.enabled`, so when it's off the assistant is off regardless of
 * `assistant.enabled`. This setting seeds the `ai.*` namespace for
 * Positron-owned AI configuration.
 */
export const AI_ENABLED_KEY = 'ai.enabled';

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'ai',
	order: 5,
	title: localize('positron.ai.title', "AI"),
	type: 'object',
	properties: {
		[AI_ENABLED_KEY]: {
			type: 'boolean',
			default: true,
			description: localize(
				'positron.ai.enabled',
				"Enable Positron's AI features, such as Posit Assistant, Posit AI Next Edit Suggestions and AI features in notebooks and the console. When disabled, all of Positron's AI features are turned off."
			),
			scope: ConfigurationScope.WINDOW,
		}
	}
});
