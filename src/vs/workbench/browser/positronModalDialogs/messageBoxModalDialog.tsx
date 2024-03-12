/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./messageBoxModalDialog';
import * as React from 'react';
import { OKModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKModalDialog';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

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
		// Create the modal React renderer.
		const positronModalReactRenderer =
			new PositronModalReactRenderer(layoutService.mainContainer);

		// The modal dialog component.
		const ModalDialog = () => {
			// The accept handler.
			const acceptHandler = () => {
				positronModalReactRenderer.dispose();
				resolve();
			};

			// Render.
			return (
				<OKModalDialog
					renderer={positronModalReactRenderer}
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
		positronModalReactRenderer.render(<ModalDialog />);
	});
};
