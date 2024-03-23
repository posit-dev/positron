/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';

/**
 * Shows the confirmation modal dialog.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param title The title.
 * @param message The message.
 * @param action The action to perform.
 */
export const showConfirmationModalDialog = async (
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
	title: string,
	message: string,
	action: () => Promise<void>
) => {
	// Create the modal React renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the confirmation modal dialog.
	renderer.render(
		<OKCancelModalDialog
			renderer={renderer}
			width={400}
			height={195}
			title={title}
			onAccept={async () => {
				renderer.dispose();
				await action();
			}}
			onCancel={() => renderer.dispose()}>
			<VerticalStack>
				<div>{message}</div>
			</VerticalStack>
		</OKCancelModalDialog>
	);
};
