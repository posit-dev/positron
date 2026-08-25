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
 * The languages the welcome page checks for environment setup problems.
 * Removing a language from the setting stops the environment health check
 * command from running for that language. Modelled on the "Show welcome
 * page on startup" checkbox, which writes `workbench.startupEditor`: a control
 * in the page that sets a real setting, so the choice syncs and an administrator
 * can set it.
 */
export const WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY = 'welcomePage.environmentChecks';

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'positron',
	order: 7,
	title: localize('positronConfigurationTitle', "Positron"),
	type: 'object',
	properties: {
		[WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY]: {
			type: 'array',
			items: { type: 'string', enum: ['python', 'r'] },
			default: ['python', 'r'],
			uniqueItems: true,
			markdownDescription: localize(
				'positron.welcomePage.environmentChecks',
				"Languages the welcome page checks for environment setup problems, such as a missing interpreter or an environment that is not ready. Remove a language to stop its checks running and hide it from the page. Remove all of them to turn the section off."
			),
			scope: ConfigurationScope.WINDOW,
		},
	},
});
