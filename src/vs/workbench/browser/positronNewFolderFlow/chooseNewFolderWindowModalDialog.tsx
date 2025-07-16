/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// // CSS.
import './chooseNewFolderWindowModalDialog.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { Button } from '../../../base/browser/ui/positronComponents/button/button.js';
import { URI } from '../../../base/common/uri.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';

export const showChooseNewFolderWindowModalDialog = (
	folderName: string,
	folderUri: URI,
	openInNewWindow: boolean,
) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Show the choose new folder window modal dialog.
	renderer.render(
		<ChooseNewFolderWindowModalDialog
			chooseNewFolderWindowAction={async (openInNewWindow: boolean) => {
				// Open the folder in the selected window.
				await renderer.services.commandService.executeCommand(
					'vscode.openFolder',
					folderUri,
					{
						forceNewWindow: openInNewWindow,
						forceReuseWindow: !openInNewWindow
					}
				);
			}}
			folderName={folderName}
			openInNewWindow={openInNewWindow}
			renderer={renderer}
		/>
	);
};

/**
 * ChooseNewFolderWindowModalDialogProps interface.
 */
interface ChooseNewFolderWindowModalDialogProps {
	renderer: PositronModalReactRenderer;
	folderName: string;
	openInNewWindow: boolean;
	chooseNewFolderWindowAction: (openInNewWindow: boolean) => Promise<void>;
}

/**
 * ChooseNewFolderWindowModalDialog component.
 * @param props The component properties.
 * @returns The component.
 */
const ChooseNewFolderWindowModalDialog = (props: ChooseNewFolderWindowModalDialogProps) => {
	// State.
	const openInNewWindow = useRef(props.openInNewWindow);

	// Button configuration.
	const newWindowButtonConfig = {
		title: localize('positron.newFolder.whereToOpen.newWindow', "New Window"),
		onClick: () => setWindowAndAccept(true)
	};
	const currentWindowButtonConfig = {
		title: localize('positron.newFolder.whereToOpen.currentWindow', "Current Window"),
		onClick: () => setWindowAndAccept(false)
	};
	const defaultButtonConfig = props.openInNewWindow ? newWindowButtonConfig : currentWindowButtonConfig;
	const otherButtonConfig = props.openInNewWindow ? currentWindowButtonConfig : newWindowButtonConfig;

	// Handle setting where to open the new folder and accept.
	const setWindowAndAccept = async (newWindow: boolean) => {
		openInNewWindow.current = newWindow;
		await accept();
	};

	// Handle accepting the dialog.
	const accept = async () => {
		props.renderer.dispose();
		await props.chooseNewFolderWindowAction(openInNewWindow.current);
	};

	// Render.
	return (
		<PositronModalDialog
			height={220}
			renderer={props.renderer}
			title={(() =>
				localize(
					'positron.newFolderCreated',
					'New Folder Created'
				))()}
			width={500}
		>
			<div className='choose-new-folder-window-modal-dialog'>
				<VerticalStack>
					<code>{props.folderName}</code>
					<div>
						{(() =>
							localize(
								'positron.newFolderCreated.whereToOpen',
								"The folder has been created. Where would you like to open it?"
							))()}
					</div>
					{/* TODO: add checkbox to save the user's selection to preferences */}
				</VerticalStack>
				<div className='folder-window-action-bar top-separator'>
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
