/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './media/positronGettingStarted.css';

// React.
import * as React from 'react';

import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
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

export interface PositronWelcomePageStartProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	commandService: ICommandService;
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
					label={(() => localize('positron.welcome.newNotebook', "New Notebook"))()}
					codicon='positron-new-notebook'
					ariaLabel={(() => localize('positron.welcome.newNotebookDescription', "Create a Python or R Notebook"))()}
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
					keybindingService={props.keybindingService}
					layoutService={props.layoutService}
				/>
				<WelcomeButton
					label={(() => localize('positron.welcome.newFile', "New File"))()}
					codicon='positron-new-file'
					ariaLabel={(() => localize('positron.welcome.newFileDescription', "Create a new file"))()}
					onPressed={() => props.commandService.executeCommand('welcome.showNewFileEntries')}
				/>
				<WelcomeConsoleButton keybindingService={props.keybindingService}
					layoutService={props.layoutService}
					languageRuntimeService={props.languageRuntimeService}
					runtimeSessionService={props.runtimeSessionService}
					runtimeStartupService={props.runtimeStartupService}
					commandService={props.commandService}
				/>

				<WelcomeButton
					label={(() => localize('positron.welcome.newProject', "New Project"))()}
					codicon='positron-new-project'
					ariaLabel={(() => localize('positron.welcome.newProjectDescription', "Create a new project"))()}
					onPressed={() => props.commandService.executeCommand(PositronNewProjectAction.ID)}
				/>
			</div>
		</div>
	);
};
