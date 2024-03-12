/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./messageBoxModalDialog';
import * as React from 'react';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * Shows the confirmation modal dialog.
 * @param layoutService The layout service.
 * @param title The title.
 * @param message The message.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const confirmationModalDialog = async (
	layoutService: IWorkbenchLayoutService,
	title: string,
	message: string
): Promise<boolean> => {
	// Return a promise that resolves when the dialog is dismissed.
	return new Promise<boolean>((resolve) => {
		// Create the modal React renderer.
		const positronModalReactRenderer =
			new PositronModalReactRenderer(layoutService.mainContainer);

		// The modal dialog component.
		const ModalDialog = () => {
			// The accept handler.
			const acceptHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(true);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(false);
			};

			// Render.
			return (
				<OKCancelModalDialog
					renderer={positronModalReactRenderer}
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
		positronModalReactRenderer.render(<ModalDialog />);
	});
};
