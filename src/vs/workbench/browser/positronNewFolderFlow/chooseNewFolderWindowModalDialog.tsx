/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './chooseNewFolderWindowModalDialog.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { Button } from '../../../base/browser/ui/positronComponents/button/button.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';

/**
 * Shows the choose new folder window modal dialog and returns a promise that resolves
 * with the user's selection of whether to open in a new window.
 * @param folderName The name of the folder to display.
 * @param preferNewWindow Whether to default to the "New Window" button.
 * @returns A promise that resolves with `true` if the user selected "New Window", `false` otherwise.
 */
export const showChooseNewFolderWindowModalDialog = (
	folderName: string,
	preferNewWindow: boolean,
): Promise<boolean> => {
	return new Promise<boolean>((resolve) => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer();

		// Show the choose new folder window modal dialog.
		renderer.render(
			<ChooseNewFolderWindowModalDialog
				folderName={folderName}
				preferNewWindow={preferNewWindow}
				renderer={renderer}
				onWindowSelected={(openInNewWindow: boolean) => {
					renderer.dispose();
					resolve(openInNewWindow);
				}}
			/>
		);
	});
};

/**
 * ChooseNewFolderWindowModalDialogProps interface.
 */
interface ChooseNewFolderWindowModalDialogProps {
	renderer: PositronModalReactRenderer;
	folderName: string;
	preferNewWindow: boolean;
	onWindowSelected: (openInNewWindow: boolean) => void;
}

/**
 * ChooseNewFolderWindowModalDialog component.
 * @param props The component properties.
 * @returns The component.
 */
const ChooseNewFolderWindowModalDialog = (props: ChooseNewFolderWindowModalDialogProps) => {
	// Button configuration.
	const newWindowButtonConfig = {
		title: localize('positron.newFolder.whereToOpen.newWindow', "New Window"),
		onClick: () => props.onWindowSelected(true)
	};
	const currentWindowButtonConfig = {
		title: localize('positron.newFolder.whereToOpen.currentWindow', "Current Window"),
		onClick: () => props.onWindowSelected(false)
	};
	const defaultButtonConfig = props.preferNewWindow ? newWindowButtonConfig : currentWindowButtonConfig;
	const otherButtonConfig = props.preferNewWindow ? currentWindowButtonConfig : newWindowButtonConfig;

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
