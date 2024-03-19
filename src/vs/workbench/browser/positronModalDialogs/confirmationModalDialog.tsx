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
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';

/**
 * Shows the confirmation modal dialog.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param title The title.
 * @param message The message.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const confirmationModalDialog = async (
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
	title: string,
	message: string
): Promise<boolean> => {
	// Return a promise that resolves when the dialog is dismissed.
	return new Promise<boolean>((resolve) => {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container: layoutService.mainContainer,
			keyEventProcessor: new StopCommandsKeyEventProcessor({
				keybindingService,
				layoutService
			})
		});

		// The modal dialog component.
		const ModalDialog = () => {
			// The accept handler.
			const acceptHandler = () => {
				renderer.dispose();
				resolve(true);
			};

			// The cancel handler.
			const cancelHandler = () => {
				renderer.dispose();
				resolve(false);
			};

			// Render.
			return (
				<OKCancelModalDialog
					renderer={renderer}
					width={400}
					height={195}
					title={title}
					accept={acceptHandler}
					cancel={cancelHandler}>
					<VerticalStack>
						<div>{message}</div>
					</VerticalStack>
				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		renderer.render(<ModalDialog />);
	});
};
