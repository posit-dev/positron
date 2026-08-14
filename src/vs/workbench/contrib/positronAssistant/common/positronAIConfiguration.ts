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
import { AI_ENABLED_KEY, NEW_PROVIDER_MODAL_KEY } from './positronAIConfigurationKeys.js';

// Re-exported so existing importers do not have to move. New callers outside
// the workbench (e.g. the extension host) should import the keys module
// directly to avoid this file's registerConfiguration side effect.
export { AI_ENABLED_KEY };

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
		},
		[NEW_PROVIDER_MODAL_KEY]: {
			type: 'boolean',
			default: true,
			description: localize(
				'positron.assistant.newProviderModal',
				"Use the Configure LLM Providers modal to connect to language model providers. It groups providers by connection state, so you can see which are connected and which need attention without selecting each one. When disabled, the Configure Providers command opens the previous dialog."
			),
			scope: ConfigurationScope.WINDOW,
		}
	}
});
