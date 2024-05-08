/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./media/positronGettingStarted';

// React.
import * as React from 'react';

import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { WelcomeButton } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomeButton';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { PositronNewProjectAction } from 'vs/workbench/browser/actions/positronActions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { WelcomeMenuButton } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomeMenuButton';
import { PythonLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoPython';
import { RLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoR';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { WelcomeConsoleButton } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomeConsoleButton';

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
				<WelcomeMenuButton label={(() => localize('positronWelcome.newNotebook', "New Notebook"))()}
					codicon='positron-new-notebook'
					ariaLabel={(() => localize('positronWelcome.newNotebookDescription', "Create a Python or R Notebook"))()}
					actions={[
						{
							renderIcon: () => <PythonLogo />,
							label: (() => localize('positronWelcome.newPythonNotebook', "Python Notebook"))(),
							run: () => props.commandService.executeCommand('ipynb.newUntitledIpynb', 'python'),
							id: 'welcome.newPythonNotebook',
							tooltip: localize('positronWelcome.newPythonNotebookDescription', "Create a new Python notebook"),
						},
						{
							renderIcon: () => <RLogo />,
							label: (() => localize('positronWelcome.newRNotebook', "R Notebook"))(),
							run: () => props.commandService.executeCommand('ipynb.newUntitledIpynb', 'r'),
							id: 'welcome.newRNotebook',
							tooltip: localize('positronWelcome.newRNotebookDescription', "Create a new R notebook"),
						},
					]}
					keybindingService={props.keybindingService}
					layoutService={props.layoutService}
				/>
				<WelcomeButton label={(() => localize('positronWelcome.newFile', "New File"))()}
					codicon='positron-new-file'
					ariaLabel={(() => localize('positronWelcome.newFileDescription', "Create a new file"))()}
					onPressed={() => props.commandService.executeCommand('welcome.showNewFileEntries')}
				/>
				<WelcomeConsoleButton keybindingService={props.keybindingService}
					layoutService={props.layoutService}
					languageRuntimeService={props.languageRuntimeService}
					runtimeSessionService={props.runtimeSessionService}
					runtimeStartupService={props.runtimeStartupService}
					commandService={props.commandService}
				/>
				<WelcomeButton label={(() => localize('positronWelcome.newProject', "New Project"))()}
					codicon='positron-new-project'
					ariaLabel={(() => localize('positronWelcome.newProjectDescription', "Create a new project"))()}
					onPressed={() => props.commandService.executeCommand(PositronNewProjectAction.ID)}
				/>
			</div>
		</div>
	);
};
