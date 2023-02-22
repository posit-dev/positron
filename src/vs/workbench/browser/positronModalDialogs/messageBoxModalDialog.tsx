/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./messageBoxModalDialog';
import * as React from 'react';
import { OKModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKModalDialog';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * Shows the message box modal dialog.
 * @param layoutService The layout service.
 * @param title The title.
 * @param message The message.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const messageBoxModalDialog = async (layoutService: IWorkbenchLayoutService, title: string, message: string): Promise<void> => {
	// Return a promise that resolves when the dialog is done.
	return new Promise<void>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(layoutService.container);

		// The modal dialog component.
		const ModalDialog = () => {
			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve();
			};

			// Render.
			return (
				<OKModalDialog
					width={400}
					height={195}
					title={title}
					accept={acceptHandler}>
					<VerticalStack>
						<div>{message}</div>
					</VerticalStack>
				</OKModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
