/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ModelTier } from './headlessLanguageModelService.js';

// Provider extra-configuration -- AWS region, OpenAI-compatible base URL,
// Vertex project/location, custom headers -- is read from the same
// `authentication.*` settings the assistant extension and provider bridge
// already define, so it is not re-registered here. See the credential shaping
// in AbstractHeadlessLanguageModelService.

/** Built-in fallback for the fast/cheap tier when its setting is unset. */
export const FAST_CHEAP_DEFAULT_PATTERNS: readonly string[] = ['haiku', 'mini', 'flash', 'gemma'];

/**
 * Configuration key backing each model tier. Adding a tier to {@link ModelTier}
 * forces an entry here, keeping the resolver and the config contribution in sync.
 */
export const TIER_SETTING_KEYS: Record<ModelTier, string> = {
	'fast-cheap': 'ai.modelSelection.fastCheap',
};

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'headlessLanguageModel',
	order: 9,
	title: localize('positron.headlessLanguageModel.title', "Language Model"),
	type: 'object',
	properties: {
		[TIER_SETTING_KEYS['fast-cheap']]: {
			type: 'array',
			items: { type: 'string' },
			default: [...FAST_CHEAP_DEFAULT_PATTERNS],
			markdownDescription: localize(
				'positron.ai.modelSelection.fastCheap',
				"Preference patterns for the fast/cheap model tier used by background language-model features. Patterns are tried in order until one matches an available model (case-insensitive)."
			),
			scope: ConfigurationScope.APPLICATION,
		},
	},
});
