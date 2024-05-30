/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// // CSS.
import 'vs/css!./chooseNewProjectWindowModalDialog';

// React.
import * as React from 'react';
import { useRef } from 'react';  // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

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
export const ChooseNewProjectWindowModalDialog = (props: ChooseNewProjectWindowModalDialogProps) => {
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
			renderer={props.renderer}
			width={320}
			height={180}
			title={(() =>
				localize(
					'positron.chooseNewProjectWindowModalDialog.title',
					'Create New Project'
				))()}
			onAccept={accept}
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
