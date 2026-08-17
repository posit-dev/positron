/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import type { BuiltinGettingStartedCategory } from './gettingStartedContent.js';
import positronWelcomePanesAndUiContent from './media/positronWelcomePanesAndUi.js';
import positronWelcomeKeybindingsContent from './media/positronWelcomeKeybindings.js';
import positronWelcomeExtensionsContent from './media/positronWelcomeExtensions.js';
import positronWelcomeGitContent from './media/positronWelcomeGit.js';

const positronWelcomeIcon = registerIcon(
	'getting-started-positron-welcome',
	Codicon.rocket,
	localize(
		'getting-started-positron-welcome-icon',
		"Icon used for the Get Started with Positron walkthrough"
	)
);

export const gettingStartedPositronWelcomeCategoryId = 'positron.welcome';

const Button = (title: string, href: string) => `[${title}](${href})`;

/**
 * Register the built-in "Get Started with Positron" walkthrough.
 *
 * This replaces the upstream `Setup` and `SetupWeb` walkthroughs, which
 * described VS Code rather than Positron and are hidden from registration. See
 * positronHiddenWalkthroughs.ts.
 *
 * The category has no `when` clause on purpose, so it shows on desktop and on
 * web. Upstream needed two categories because its desktop and web content
 * differed; every step here applies to both.
 */
export function registerGettingStartedPositronWelcome(
	registry: {
		registerProvider: (moduleId: string, provider: () => string) => void;
	},
	registerCategory: (category: BuiltinGettingStartedCategory) => void,
) {
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/positronWelcomePanesAndUi',
		positronWelcomePanesAndUiContent
	);
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/positronWelcomeKeybindings',
		positronWelcomeKeybindingsContent
	);
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/positronWelcomeExtensions',
		positronWelcomeExtensionsContent
	);
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/positronWelcomeGit',
		positronWelcomeGitContent
	);

	registerCategory({
		id: gettingStartedPositronWelcomeCategoryId,
		title: localize(
			'positron.gettingStarted.welcome.title',
			"Get Started with Positron"
		),
		description: localize(
			'positron.gettingStarted.welcome.description',
			"Find your way around the panes, shortcuts, and tools built for data science"
		),
		isFeatured: true,
		icon: positronWelcomeIcon,
		walkthroughPageTitle: localize(
			'positron.gettingStarted.welcome.walkthroughPageTitle',
			"Get Started with Positron"
		),
		content: {
			type: 'steps',
			steps: [
				{
					id: 'positron.welcome.theme',
					title: localize(
						'positron.gettingStarted.welcome.theme.title',
						"Choose Your Theme"
					),
					description: localize(
						'positron.gettingStarted.welcome.theme.description',
						"The right theme helps you focus on your code and is easier on your eyes\n{0}",
						Button(
							localize(
								'positron.gettingStarted.welcome.theme.button',
								"Browse Color Themes"
							),
							'command:workbench.action.selectTheme'
						)
					),
					completionEvents: [
						'onSettingChanged:workbench.colorTheme',
						'onCommand:workbench.action.selectTheme',
					],
					// Reuses the upstream theme picker, which renders live theme
					// swatches. It is registered in gettingStartedContent.ts,
					// outside the walkthrough list, so hiding `Setup` leaves it
					// available.
					media: { type: 'markdown', path: 'theme_picker' },
				},
				{
					id: 'positron.welcome.panesAndUI',
					title: localize(
						'positron.gettingStarted.welcome.panesAndUI.title',
						"Get to Know the Positron UI"
					),
					description: localize(
						'positron.gettingStarted.welcome.panesAndUI.description',
						"Explore the Console, Variables, Plots, and the other panes built for interactive data science\n{0}",
						Button(
							localize(
								'positron.gettingStarted.welcome.panesAndUI.button',
								"Customize Your Layout"
							),
							'command:workbench.action.customizeLayout'
						)
					),
					completionEvents: ['onCommand:workbench.action.customizeLayout'],
					media: { type: 'markdown', path: 'positronWelcomePanesAndUi' },
				},
				{
					id: 'positron.welcome.keybindings',
					title: localize(
						'positron.gettingStarted.welcome.keybindings.title',
						"Keyboard Shortcuts"
					),
					description: localize(
						'positron.gettingStarted.welcome.keybindings.description',
						"Reach any command from the keyboard, and change the bindings you use most\n{0}",
						Button(
							localize(
								'positron.gettingStarted.welcome.keybindings.button',
								"Open Keyboard Shortcuts"
							),
							'command:toSide:workbench.action.openGlobalKeybindings'
						)
					),
					completionEvents: ['onCommand:workbench.action.openGlobalKeybindings'],
					media: { type: 'markdown', path: 'positronWelcomeKeybindings' },
				},
				{
					id: 'positron.welcome.extensions',
					title: localize(
						'positron.gettingStarted.welcome.extensions.title',
						"Code with Extensions"
					),
					description: localize(
						'positron.gettingStarted.welcome.extensions.description',
						"See what Positron already includes, and add the extensions you want\n{0}",
						Button(
							localize(
								'positron.gettingStarted.welcome.extensions.button',
								"Browse Extensions"
							),
							'command:workbench.extensions.action.focusExtensionsView'
						)
					),
					completionEvents: ['onCommand:workbench.extensions.action.focusExtensionsView'],
					media: { type: 'markdown', path: 'positronWelcomeExtensions' },
				},
				{
					id: 'positron.welcome.git',
					title: localize(
						'positron.gettingStarted.welcome.git.title',
						"Track Your Code with Git"
					),
					description: localize(
						'positron.gettingStarted.welcome.git.description',
						"Clone a repository or put the folder you are working in under version control\n{0}",
						Button(
							localize(
								'positron.gettingStarted.welcome.git.button',
								"New Folder from Git"
							),
							'command:positron.workbench.action.newFolderFromGit'
						)
					),
					completionEvents: ['onCommand:positron.workbench.action.newFolderFromGit'],
					media: { type: 'markdown', path: 'positronWelcomeGit' },
				},
			]
		}
	});
}
