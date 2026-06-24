/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import type { BuiltinGettingStartedCategory } from './gettingStartedContent.js';
import notebooksPanesAndUiContent from './media/notebooksPanesAndUi.js';
import notebooksInterpreterContent from './media/notebooksInterpreter.js';
import notebooksAiAssistantContent from './media/notebooksAiAssistant.js';
import notebooksLearnMoreContent from './media/notebooksLearnMore.js';

const notebooksWelcomeIcon = registerIcon(
	'getting-started-notebooks',
	Codicon.notebook,
	localize(
		'getting-started-notebooks-icon',
		"Icon used for the notebooks walkthrough"
	)
);

export const gettingStartedPositronNotebookCategoryId = 'notebooks.welcome';

const Button = (title: string, href: string) => `[${title}](${href})`;

/**
 * Register the built-in getting started walkthrough for the Positron Notebook Editor.
 */
export function registerGettingStartedPositronNotebook(
	registry: {
		registerProvider: (moduleId: string, provider: () => string) => void;
	},
	registerCategory: (category: BuiltinGettingStartedCategory) => void,
) {
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/notebooksPanesAndUi',
		notebooksPanesAndUiContent
	);
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/notebooksInterpreter',
		notebooksInterpreterContent
	);
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/notebooksAiAssistant',
		notebooksAiAssistantContent
	);
	registry.registerProvider(
		'vs/workbench/contrib/welcomeGettingStarted/common/media/notebooksLearnMore',
		notebooksLearnMoreContent
	);

	registerCategory({
		id: gettingStartedPositronNotebookCategoryId,
		title: localize(
			'gettingStarted.notebooksWelcome.title',
			"Get Started with Jupyter Notebooks"
		),
		description: localize(
			'gettingStarted.notebooksWelcome.description',
			"Learn how to work with Jupyter notebooks in Positron"
		),
		isFeatured: true,
		icon: notebooksWelcomeIcon,
		walkthroughPageTitle: localize(
			'gettingStarted.notebooksWelcome.walkthroughPageTitle',
			"Jupyter Notebooks in Positron"
		),
		content: {
			type: 'steps',
			steps: [
				{
					id: 'notebooks.panesAndUI',
					title: localize(
						'gettingStarted.notebooksWelcome.panesAndUI.title',
						"Get to Know the Positron UI"
					),
					description: localize(
						'gettingStarted.notebooksWelcome.panesAndUI.description',
						"Explore the panes and layout options designed for interactive data science when working with notebooks\n{0}",
						Button(
							localize(
								'gettingStarted.notebooksWelcome.panesAndUI.button',
								"Read the Documentation"
							),
							'https://positron.posit.co/positron-notebook-editor'
						)
					),
					completionEvents: ['onLink:https://positron.posit.co/positron-notebook-editor'],
					media: { type: 'markdown', path: 'notebooksPanesAndUi' },
				},
				{
					id: 'notebooks.interpreter',
					title: localize(
						'gettingStarted.notebooksWelcome.interpreter.title',
						"Select an Interpreter"
					),
					description: localize(
						'gettingStarted.notebooksWelcome.interpreter.description',
						"Choose the Python or R environment for your notebook\n{0}",
						Button(
							localize(
								'gettingStarted.notebooksWelcome.interpreter.button',
								"Interpreter Documentation"
							),
							'https://positron.posit.co/positron-notebook-editor.html#selecting-a-notebook-kernel'
						)
					),
					completionEvents: ['onLink:https://positron.posit.co/positron-notebook-editor.html#selecting-a-notebook-kernel'],
					media: { type: 'markdown', path: 'notebooksInterpreter' },
				},
				{
					id: 'notebooks.aiAssistant',
					title: localize(
						'gettingStarted.notebooksWelcome.aiAssistant.title',
						"Context-Aware AI for Notebooks"
					),
					description: localize(
						'gettingStarted.notebooksWelcome.aiAssistant.description',
						"Get help with an assistant that understands your data and execution history, not just your code\n{0}",
						Button(
							localize(
								'gettingStarted.notebooksWelcome.aiAssistant.button',
								"Open Posit Assistant"
							),
							'command:workbench.view.extension.posit-assistant'
						)
					),
					completionEvents: ['onCommand:workbench.view.extension.posit-assistant'],
					media: { type: 'markdown', path: 'notebooksAiAssistant' },
				},
				{
					id: 'notebooks.learnMore',
					title: localize(
						'gettingStarted.notebooksWelcome.learnMore.title',
						"Learn More"
					),
					description: localize(
						'gettingStarted.notebooksWelcome.learnMore.description',
						"Create your first notebook, explore tutorials and more\n{0}",
						Button(
							localize(
								'gettingStarted.notebooksWelcome.newNotebook.button',
								"Create a Notebook"
							),
							'command:workbench.action.positronNewNotebookWithLayout'
						)
					),
					completionEvents: ['onCommand:workbench.action.positronNewNotebookWithLayout'],
					media: { type: 'markdown', path: 'notebooksLearnMore' },
				},
			]
		}
	});
}
