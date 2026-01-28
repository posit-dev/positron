/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './media/positronGettingStarted.css';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { WelcomeButton } from './positronWelcomeButton.js';
import { PositronNewFolderFromGitAction, PositronNewFolderFromTemplateAction } from '../../../browser/actions/positronActions.js';
import { OpenFolderAction } from '../../../browser/actions/workspaceActions.js';
import { LogoPythonProject } from '../../../browser/positronNewFolderFlow/components/logos/logoPythonProject.js';
import { LogoRProject } from '../../../browser/positronNewFolderFlow/components/logos/logoRProject.js';
import { WelcomeMenuButton } from './positronWelcomeMenuButton.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';


const WelcomePageWorkspace = () => {
	const services = usePositronReactServicesContext();
	return (
		<>
			<WelcomeMenuButton
				actions={[
					{
						renderIcon: () => <LogoPythonProject />,
						label: (() => localize('positron.welcome.newPythonNotebook', "Python Notebook"))(),
						run: () => services.commandService.executeCommand('ipynb.newUntitledIpynb', 'python'),
						id: 'welcome.newPythonNotebook',
						tooltip: localize('positron.welcome.newPythonNotebookDescription', "Create a new Python notebook"),
					},
					{
						renderIcon: () => <LogoRProject />,
						label: (() => localize('positron.welcome.newRNotebook', "R Notebook"))(),
						run: () => services.commandService.executeCommand('ipynb.newUntitledIpynb', 'r'),
						id: 'welcome.newRNotebook',
						tooltip: localize('positron.welcome.newRNotebookDescription', "Create a new R notebook"),
					},
				]}
				ariaLabel={(() => localize('positron.welcome.newNotebookDescription', "Create a Python or R Notebook"))()}
				codicon='positron-new-notebook'
				label={(() => localize('positron.welcome.newNotebook', "New Notebook"))()}
			/>
			<WelcomeButton
				ariaLabel={localize('positron.welcome.newFile', "New File")}
				codicon='positron-new-file'
				label={localize('positron.welcome.newFile', "New File")}
				onPressed={() => services.commandService.executeCommand('welcome.showNewFileEntries')}
			/>
		</>
	);
};

const WelcomePageNoWorkspace = () => {
	const services = usePositronReactServicesContext();
	return (
		<>
			<WelcomeButton
				ariaLabel={localize('positronOpenFolder', "Open Folder...")}
				codicon='positron-open-folder'
				label={localize('positronOpenFolder', "Open Folder...")}
				onPressed={() => services.commandService.executeCommand(OpenFolderAction.ID)}
			/>
			<WelcomeButton
				ariaLabel={localize('positron.welcome.newFolderFromTemplate', "New Folder...")}
				codicon='positron-new-folder'
				label={localize('positron.welcome.newFolderFromTemplate', "New Folder...")}
				onPressed={() => services.commandService.executeCommand(PositronNewFolderFromTemplateAction.ID)}
			/>
			<WelcomeButton
				ariaLabel={localize('positron.welcome.newFolderFromGit', "New from Git...")}
				codicon='positron-new-folder-from-git'
				label={localize('positron.welcome.newFolderFromGit', "New from Git...")}
				onPressed={() => services.commandService.executeCommand(PositronNewFolderFromGitAction.ID)}
			/>
		</>
	);
};

export const PositronWelcomePageStart = () => {
	const services = usePositronReactServicesContext();
	const workspaceFolders = services.workspaceContextService.getWorkspace().folders;

	return (
		<div className='positron-welcome-page-start buttons'>
			{workspaceFolders.length > 0
				? (<WelcomePageWorkspace />)
				: (<WelcomePageNoWorkspace />)}
		</div>
	)
};
