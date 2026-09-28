/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './chooseNewFolderWindowModalDialog.css';

// Other dependencies.
import { localize } from '../../../nls.js';
import { TwoButtonFooter } from '../positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
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
 * @returns The rendered component.
 */
const ChooseNewFolderWindowModalDialog = (props: ChooseNewFolderWindowModalDialogProps) => {
	// The window the user prefers is the primary button, so Enter opens the folder there.
	const newWindowTitle = localize('positron.newFolder.whereToOpen.newWindow', "New Window");
	const currentWindowTitle = localize('positron.newFolder.whereToOpen.currentWindow', "Current Window");

	// Render. There is no cancel: the folder already exists, so the only question left is where
	// to open it.
	return (
		<PositronDynamicModalDialog
			content={
				<div className='choose-new-folder-window-modal-dialog'>
					<code>{props.folderName}</code>
					<div>
						{localize(
							'positron.newFolderCreated.whereToOpen',
							"The folder has been created. Where would you like to open it?"
						)}
					</div>
					{/* TODO: add checkbox to save the user's selection to preferences */}
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={props.preferNewWindow ? newWindowTitle : currentWindowTitle}
					secondaryButtonTitle={props.preferNewWindow ? currentWindowTitle : newWindowTitle}
					topBorder={true}
					onPrimaryButton={() => props.onWindowSelected(props.preferNewWindow)}
					onSecondaryButton={() => props.onWindowSelected(!props.preferNewWindow)}
				/>
			}
			renderer={props.renderer}
			title={localize(
				'positron.newFolderCreated',
				'New Folder Created'
			)}
			width={500}
		/>
	);
};
