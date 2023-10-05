/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderModalPopup';
import * as React from 'react';
import { ILabelService } from 'vs/platform/label/common/label';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { PositronModalPopupReactRenderer } from 'vs/base/browser/ui/positronModalPopup/positronModalPopupReactRenderer';
import { CustomFolderMenuItems } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuItems';

/**
 * Shows the custom folder modal popup.
 * @param container The container of the application.
 * @param anchorElement The anchor element for the runtimes manager modal popup.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showCustomFolderPopup = async (
	commandService: ICommandService,
	contextKeyService: IContextKeyService,
	labelService: ILabelService,
	workspacesService: IWorkspacesService,
	container: HTMLElement,
	anchorElement: HTMLElement
): Promise<void> => {
	const recentlyOpened = await workspacesService.getRecentlyOpened();

	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Create the modal popup React renderer.
		const positronModalPopupReactRenderer = new PositronModalPopupReactRenderer(container);

		// The modal popup component.
		const ModalPopup = () => {
			/**
			 * Dismisses the popup.
			 */
			const dismiss = () => {
				positronModalPopupReactRenderer.destroy();
				resolve();
			};

			// Render.
			return (
				<PositronModalPopup
					anchorElement={anchorElement}
					popupPosition='bottom'
					popupAlignment='right'
					width={275}
					height={'min-content'}
					onDismiss={() => dismiss()}
				>
					<CustomFolderMenuItems
						commandService={commandService}
						contextKeyService={contextKeyService}
						labelService={labelService}
						recentlyOpened={recentlyOpened}
						onMenuItemSelected={dismiss} />
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalPopupReactRenderer.render(<ModalPopup />);
	});
};
