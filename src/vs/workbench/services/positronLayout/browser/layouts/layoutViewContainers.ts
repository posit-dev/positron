/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The view containers task layouts hide, grouped by what the user sees. Some
 * features add more than one container, such as an activity bar item and a
 * secondary side bar tab, so each group lists all of them.
 */
export const LayoutViewContainers = {
	sourceControl: ['workbench.view.scm'],
	gitHub: ['workbench.view.extension.github-pull-requests', 'workbench.view.extension.github-pull-request'],
	assistant: ['workbench.view.extension.posit-assistant', 'workbench.panel.chat'],
	dataConnections: ['workbench.panel.positronDataConnections', 'workbench.view.extension.positron-connections'],
	packages: ['workbench.viewContainer.positronPackages'],
	publisher: ['workbench.view.extension.posit-publisher', 'workbench.view.extension.posit-publisher-logs'],
} as const satisfies Record<string, readonly string[]>;
