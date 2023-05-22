/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./deleteAllObjectsModalDialog';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * DeleteAllObjectsResult interface.
 */
export interface DeleteAllObjectsResult {
	includeHiddenObjects: boolean;
}

/**
 * Shows the delete all objects modal dialog.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showDeleteAllObjectsModalDialog = async (
	layoutService: IWorkbenchLayoutService
): Promise<DeleteAllObjectsResult | undefined> => {

	// Return a promise that resolves when the dialog is done.
	return new Promise<DeleteAllObjectsResult | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(
			layoutService.container
		);

		// The modal dialog component.
		const ModalDialog = () => {
			// Hooks.
			const [result, _setResult] = useState<DeleteAllObjectsResult>({
				includeHiddenObjects: false
			});

			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(result);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(undefined);
			};

			// Render.
			return (
				<OKCancelModalDialog
					width={375}
					height={175}
					title={localize('positronDeleteAllObjectsModalDialogTitle', "Delete All Objects")}
					okButtonTitle={localize('positronYes', "Yes")}
					cancelButtonTitle={localize('positronNo', "No")}
					accept={acceptHandler} cancel={cancelHandler}>

					<VerticalStack>
						<div>{localize('positronDeleteAllObjectsModalDialogText', "Are you sure you want to delete all objects from the environment? This operation cannot be undone.")}</div>
						{/* Disabled for Private Alpha. */}
						{/* <Checkbox label='Include hidden objects' onChanged={checked => setResult({ ...result, includeHiddenObjects: checked })} /> */}
					</VerticalStack>

				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
