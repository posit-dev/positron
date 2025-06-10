/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './media/positronGettingStarted.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { WelcomeButton } from './positronWelcomeButton.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { PositronNewFolderFromTemplateAction } from '../../../browser/actions/positronActions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { WelcomeMenuButton } from './positronWelcomeMenuButton.js';
import { LogoPythonProject } from '../../../browser/positronNewFolderFlow/components/logos/logoPythonProject.js';
import { LogoRProject } from '../../../browser/positronNewFolderFlow/components/logos/logoRProject.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export interface PositronWelcomePageStartProps {
	commandService: ICommandService;
	configurationService: IConfigurationService;
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
}

export const PositronWelcomePageStart = (props: PropsWithChildren<PositronWelcomePageStartProps>) => {

	// Render.
	return (
		<div className='positron-welcome-page-open welcome-page-section'>
			<h2>Start</h2>
			<div className='positron-welcome-page-start buttons'>
				<WelcomeMenuButton
					actions={[
						{
							renderIcon: () => <LogoPythonProject />,
							label: (() => localize('positron.welcome.newPythonNotebook', "Python Notebook"))(),
							run: () => props.commandService.executeCommand('ipynb.newUntitledIpynb', 'python'),
							id: 'welcome.newPythonNotebook',
							tooltip: localize('positron.welcome.newPythonNotebookDescription', "Create a new Python notebook"),
						},
						{
							renderIcon: () => <LogoRProject />,
							label: (() => localize('positron.welcome.newRNotebook', "R Notebook"))(),
							run: () => props.commandService.executeCommand('ipynb.newUntitledIpynb', 'r'),
							id: 'welcome.newRNotebook',
							tooltip: localize('positron.welcome.newRNotebookDescription', "Create a new R notebook"),
						},
					]}
					ariaLabel={(() => localize('positron.welcome.newNotebookDescription', "Create a Python or R Notebook"))()}
					codicon='positron-new-notebook'
					keybindingService={props.keybindingService}
					label={(() => localize('positron.welcome.newNotebook', "New Notebook"))()}
					layoutService={props.layoutService}
				/>
				<WelcomeButton
					ariaLabel={(() => localize('positron.welcome.newFileDescription', "Create a new file"))()}
					codicon='positron-new-file'
					label={(() => localize('positron.welcome.newFile', "New File"))()}
					onPressed={() => props.commandService.executeCommand('welcome.showNewFileEntries')}
				/>
				<WelcomeButton
					ariaLabel={(() => localize('positron.welcome.newFolderDescription', "Create a new folder from a template"))()}
					codicon='positron-new-project'
					label={(() => localize('positron.welcome.newFolderFromTemplate', "New Folder"))()}
					onPressed={() => props.commandService.executeCommand(PositronNewFolderFromTemplateAction.ID)}
				/>
			</div>
		</div>
	);
};
