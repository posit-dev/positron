/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./messageBoxModalDialog';
import * as React from 'react';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * Shows the confirmation modal dialog.
 * @param layoutService The layout service.
 * @param title The title.
 * @param message The message.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const confirmationModalDialog = async (layoutService: IWorkbenchLayoutService, title: string, message: string): Promise<boolean> => {
	// Return a promise that resolves when the dialog is done.
	return new Promise<boolean>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(layoutService.container);

		// The modal dialog component.
		const ModalDialog = () => {
			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(true);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(false);
			};

			// Render.
			return (
				<OKCancelModalDialog
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
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
