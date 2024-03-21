/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./messageBoxModalDialog';

// React.
import * as React from 'react';

// Other dependencies.
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { OKModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKModalDialog';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';

/**
 * Shows the message box modal dialog.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param title The title.
 * @param message The message.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const messageBoxModalDialog = async (
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
	title: string,
	message: string
): Promise<void> => {
	// Return a promise that resolves when the dialog is done.
	return new Promise<void>((resolve) => {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService,
			layoutService,
			container: layoutService.mainContainer
		});

		// The modal dialog component.
		const ModalDialog = () => {
			// The accept handler.
			const acceptHandler = () => {
				renderer.dispose();
				resolve();
			};

			// Render.
			return (
				<OKModalDialog
					renderer={renderer}
					width={400}
					height={195}
					title={title}
					onAccept={acceptHandler}>
					<VerticalStack>
						<div>{message}</div>
					</VerticalStack>
				</OKModalDialog>
			);
		};

		// Render the modal dialog component.
		renderer.render(<ModalDialog />);
	});
};
