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
 * Configuration key that gates the redesigned welcome page. While this is off,
 * the welcome page renders its original contents.
 *
 * This is a development switch, not a user-facing setting. It is registered
 * with `included: false` so it stays out of the Settings editor and out of
 * settings.json IntelliSense. Turn it on by hand-editing settings.json:
 *
 *     "welcomePage.experimental": true
 *
 * Remove the setting once the redesigned page replaces the original one. The
 * original page's files go with it, and their names do not make that obvious:
 * `positronWelcomePageLeft.tsx`, `positronWelcomePageStart.tsx`,
 * `positronWelcomeButton.tsx` and `positronWelcomeMenuButton.tsx` in
 * `browser/` all belong to the original page, not to `browser/positronWelcomePage/`.
 */
export const WELCOME_PAGE_EXPERIMENTAL_KEY = 'welcomePage.experimental';

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
		[WELCOME_PAGE_EXPERIMENTAL_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.welcomePage.experimental',
				"Enable the redesigned welcome page. This feature is under active development and may change or be removed without notice."
			),
			tags: ['experimental'],
			scope: ConfigurationScope.WINDOW,
			included: false,
		},
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
