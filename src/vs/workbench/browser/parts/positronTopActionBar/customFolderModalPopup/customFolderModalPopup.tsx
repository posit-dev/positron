/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./customFolderModalPopup';

// React.
import * as React from 'react';

// Other dependencies.
import { ILabelService } from 'vs/platform/label/common/label';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';
import { CustomFolderMenuItems } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuItems';

/**
 * Shows the custom folder modal popup.
 * @param commandService The command service.
 * @param contextKeyService The context key service.
 * @param hostService The host service.
 * @param keybindingService The keybinding service.
 * @param labelService The label service.
 * @param layoutService The layout service.
 * @param workspacesService The workspaces service.
 * @param container The container element.
 * @param anchor The anchor element for the modal popup.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showCustomFolderModalPopup = async (
	commandService: ICommandService,
	contextKeyService: IContextKeyService,
	hostService: IHostService,
	keybindingService: IKeybindingService,
	labelService: ILabelService,
	layoutService: ILayoutService,
	workspacesService: IWorkspacesService,
	container: HTMLElement,
	anchor: HTMLElement
): Promise<void> => {
	// Gets the workspaces recently opened.
	const recentlyOpened = await workspacesService.getRecentlyOpened();

	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container,
			keyEventProcessor: new StopCommandsKeyEventProcessor({
				keybindingService,
				layoutService
			})
		});

		// The modal popup component.
		const ModalPopup = () => {
			/**
			 * Dismisses the popup.
			 */
			const dismiss = () => {
				renderer.dispose();
				resolve();
			};

			// Render.
			return (
				<PositronModalPopup
					renderer={renderer}
					container={container}
					anchor={anchor}
					popupPosition='bottom'
					popupAlignment='right'
					minWidth={275}
					width={'max-content'}
					height={'min-content'}
					keyboardNavigation='menu'
					onDismiss={() => dismiss()}
				>
					<CustomFolderMenuItems
						commandService={commandService}
						contextKeyService={contextKeyService}
						hostService={hostService}
						labelService={labelService}
						recentlyOpened={recentlyOpened}
						onMenuItemSelected={dismiss}
					/>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		renderer.render(<ModalPopup />);
	});
};
