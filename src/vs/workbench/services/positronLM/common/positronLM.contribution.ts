/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';
import { FAST_CHEAP_DEFAULT_PATTERNS, TIER_SETTING_KEYS } from './positronLMService.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		id: 'languageModels',
		title: localize('positron.languageModels', "Language Models"),
		properties: {
			[TIER_SETTING_KEYS['fast-cheap']]: {
				type: 'array',
				items: { type: 'string' },
				default: [...FAST_CHEAP_DEFAULT_PATTERNS],
				markdownDescription: localize(
					'positron.languageModels.fastcheap',
					"Model preference patterns for the fast-cheap tier. Patterns are matched case-insensitively as substrings against model IDs and names. First match wins."
				),
			},
		}
	});
