/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// // CSS.
import './chooseNewProjectWindowModalDialog.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalReactRenderer } from '../positronModalReactRenderer/positronModalReactRenderer.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { Button } from '../../../base/browser/ui/positronComponents/button/button.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IWorkbenchLayoutService } from '../../services/layout/browser/layoutService.js';
import { URI } from '../../../base/common/uri.js';

export const showChooseNewProjectWindowModalDialog = (
	commandService: ICommandService,
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
	projectName: string,
	projectFolder: URI,
	openInNewWindow: boolean,
) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the choose new project window modal dialog.
	renderer.render(
		<ChooseNewProjectWindowModalDialog
			chooseNewProjectWindowAction={async (openInNewWindow: boolean) => {
				// Open the project in the selected window.
				await commandService.executeCommand(
					'vscode.openFolder',
					projectFolder,
					{
						forceNewWindow: openInNewWindow,
						forceReuseWindow: !openInNewWindow
					}
				);
			}}
			openInNewWindow={openInNewWindow}
			projectName={projectName}
			renderer={renderer}
		/>
	);
};

/**
 * ChooseNewProjectWindowModalDialogProps interface.
 */
interface ChooseNewProjectWindowModalDialogProps {
	renderer: PositronModalReactRenderer;
	projectName: string;
	openInNewWindow: boolean;
	chooseNewProjectWindowAction: (openInNewWindow: boolean) => Promise<void>;
}

/**
 * ChooseNewProjectWindowModalDialog component.
 * @param props The component properties.
 * @returns The component.
 */
const ChooseNewProjectWindowModalDialog = (props: ChooseNewProjectWindowModalDialogProps) => {
	// State.
	const openInNewWindow = useRef(props.openInNewWindow);

	// Button configuration.
	const newWindowButtonConfig = {
		title: localize('positron.newProject.whereToOpen.newWindow', "New Window"),
		onClick: () => setWindowAndAccept(true)
	};
	const currentWindowButtonConfig = {
		title: localize('positron.newProject.whereToOpen.currentWindow', "Current Window"),
		onClick: () => setWindowAndAccept(false)
	};
	const defaultButtonConfig = props.openInNewWindow ? newWindowButtonConfig : currentWindowButtonConfig;
	const otherButtonConfig = props.openInNewWindow ? currentWindowButtonConfig : newWindowButtonConfig;

	// Handle setting where to open the new project and accept.
	const setWindowAndAccept = async (newWindow: boolean) => {
		openInNewWindow.current = newWindow;
		await accept();
	};

	// Handle accepting the dialog.
	const accept = async () => {
		props.renderer.dispose();
		await props.chooseNewProjectWindowAction(openInNewWindow.current);
	};

	// Render.
	return (
		<PositronModalDialog
			height={180}
			renderer={props.renderer}
			title={(() =>
				localize(
					'positron.chooseNewProjectWindowModalDialog.title',
					'Create New Project'
				))()}
			width={320}
		>
			<div className='choose-new-project-window-modal-dialog'>
				<VerticalStack>
					<div>
						{(() =>
							localize(
								'positron.newProject.whereToOpen.question',
								"Where would you like to open your new project "
							))()}<code>{props.projectName}</code>{'?'}
					</div>
					{/* TODO: add checkbox to save the user's selection to preferences */}
				</VerticalStack>
				<div className='project-window-action-bar top-separator'>
					<Button className='button action-bar-button' onPressed={otherButtonConfig.onClick}>
						{otherButtonConfig.title}
					</Button>
					<Button className='button action-bar-button default' onPressed={defaultButtonConfig.onClick}>
						{defaultButtonConfig.title}
					</Button>
				</div>
			</div>
		</PositronModalDialog>
	);
};
