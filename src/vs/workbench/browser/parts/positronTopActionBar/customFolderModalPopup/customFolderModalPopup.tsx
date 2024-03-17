/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
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
import { StopCommandsKeyEventProcessor } from 'vs/workbench/browser/stopCommandsKeyEventProcessor';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { CustomFolderMenuItems } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuItems';

/**
 * Shows the custom folder modal popup.
 * @param options The custom folder modal popup options.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showCustomFolderModalPopup = async (options: {
	commandService: ICommandService;
	contextKeyService: IContextKeyService;
	hostService: IHostService;
	keybindingService: IKeybindingService;
	labelService: ILabelService;
	layoutService: ILayoutService;
	workspacesService: IWorkspacesService;
	container: HTMLElement;
	anchor: HTMLElement;
}): Promise<void> => {
	// Gets the workspaces recently opened.
	const recentlyOpened = await options.workspacesService.getRecentlyOpened();

	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container: options.container,
			keyEventProcessor: new StopCommandsKeyEventProcessor(options)
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
					containerElement={options.container}
					anchorElement={options.anchor}
					popupPosition='bottom'
					popupAlignment='right'
					minWidth={275}
					width={'max-content'}
					height={'min-content'}
					keyboardNavigation='menu'
					onDismiss={() => dismiss()}
				>
					<CustomFolderMenuItems
						commandService={options.commandService}
						contextKeyService={options.contextKeyService}
						hostService={options.hostService}
						labelService={options.labelService}
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
