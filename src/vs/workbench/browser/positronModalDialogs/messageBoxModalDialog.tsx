/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./messageBoxModalDialog';

// React.
import * as React from 'react';

// Other dependencies.
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { OKModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKModalDialog';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';

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
				resolve();
			};

			// Render.
			return (
				<OKModalDialog
					renderer={renderer}
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
		renderer.render(<ModalDialog />);
	});
};
