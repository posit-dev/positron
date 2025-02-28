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
import { PositronNewProjectAction } from '../../../browser/actions/positronActions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { WelcomeMenuButton } from './positronWelcomeMenuButton.js';
import { PythonLogo } from '../../../browser/positronNewProjectWizard/components/logos/logoPython.js';
import { RLogo } from '../../../browser/positronNewProjectWizard/components/logos/logoR.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { WelcomeConsoleButton } from './positronWelcomeConsoleButton.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export interface PositronWelcomePageStartProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	commandService: ICommandService;
	configurationService: IConfigurationService;
	runtimeSessionService: IRuntimeSessionService;
	runtimeStartupService: IRuntimeStartupService;
	languageRuntimeService: ILanguageRuntimeService;
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
							renderIcon: () => <PythonLogo />,
							label: (() => localize('positron.welcome.newPythonNotebook', "Python Notebook"))(),
							run: () => props.commandService.executeCommand('ipynb.newUntitledIpynb', 'python'),
							id: 'welcome.newPythonNotebook',
							tooltip: localize('positron.welcome.newPythonNotebookDescription', "Create a new Python notebook"),
						},
						{
							renderIcon: () => <RLogo />,
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
				<WelcomeConsoleButton
					commandService={props.commandService}
					configurationService={props.configurationService}
					keybindingService={props.keybindingService}
					languageRuntimeService={props.languageRuntimeService}
					layoutService={props.layoutService}
					runtimeSessionService={props.runtimeSessionService}
					runtimeStartupService={props.runtimeStartupService}
				/>

				<WelcomeButton
					ariaLabel={(() => localize('positron.welcome.newProjectDescription', "Create a new project"))()}
					codicon='positron-new-project'
					label={(() => localize('positron.welcome.newProject', "New Project"))()}
					onPressed={() => props.commandService.executeCommand(PositronNewProjectAction.ID)}
				/>
			</div>
		</div>
	);
};
