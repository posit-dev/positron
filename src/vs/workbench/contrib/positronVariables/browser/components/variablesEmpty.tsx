/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variablesEmpty.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';

// The walkthrough is owned by gettingStartedPositronWelcomeContent.ts. It is
// named by ID so this pane does not import the welcome contribution.
const OPEN_WALKTHROUGH_COMMAND_ID = 'workbench.action.openWalkthrough';
const POSITRON_WALKTHROUGH_ID = 'positron.welcome';
const MINIMIZE_PANEL_COMMAND_ID = 'workbench.action.minimizePanel';
const CLOSE_SIDEBAR_COMMAND_ID = 'workbench.action.closeSidebar';

// VariablesEmptyProps interface.
interface VariablesEmptyProps {
	initializing: boolean;
}

/**
 * Localized strings.
 */
const titleFilter = localize('positron.noVariables.filter', 'No variables match the current filter.');
const variablesHint = localize('positron.variables.empty.variablesHint', "Variables created in your session appear here.");
const plotsHint = localize('positron.variables.empty.plotsHint', "Plots you create open in the Plots pane.");
const tour = localize('positron.variables.empty.tour', "Take a tour of the Positron UI");

/**
 * VariablesEmpty component.
 * @param props A VariablesEmptyProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariablesEmpty = (props: VariablesEmptyProps) => {

	const services = usePositronReactServicesContext();
	const context = usePositronVariablesContext();
	const hasFilter = context.activePositronVariablesInstance?.hasFilterText();

	if (props.initializing) {
		return <div className='variables-empty'>
			<div className='title'>...</div>
		</div>;
	}

	// Someone who typed a filter that matched nothing needs to hear that, not
	// an introduction to the pane.
	if (hasFilter) {
		return <div className='variables-empty'>
			<div className='title'>{titleFilter}</div>
		</div>;
	}

	// The walkthrough shows its steps and their content side by side only in a
	// wide editor, and the default layout's editor is too narrow. The panel is
	// minimized, not hidden, so its tabs still show where the Console went, and
	// the primary side bar is closed. Both happen first, so the editor is its
	// final size when the page lays out.
	const openTour = async () => {
		await services.commandService.executeCommand(MINIMIZE_PANEL_COMMAND_ID);
		await services.commandService.executeCommand(CLOSE_SIDEBAR_COMMAND_ID);
		await services.commandService.executeCommand(OPEN_WALKTHROUGH_COMMAND_ID, POSITRON_WALKTHROUGH_ID);
	};

	// The Plots view starts collapsed, so this pane is most of what a new user
	// sees in this part of the window. It says what both panes are for.
	return <div className='variables-empty variables-empty-intro'>
		<span aria-hidden='true' className='variables-empty-icon codicon codicon-positron-variables' />
		<div className='hint'>{variablesHint}</div>
		<div className='hint'>{plotsHint}</div>
		<Button className='variables-empty-action' onPressed={openTour}>
			<span aria-hidden='true' className='variables-empty-action-icon codicon codicon-rocket' />
			{tour}
		</Button>
	</div>;
};
