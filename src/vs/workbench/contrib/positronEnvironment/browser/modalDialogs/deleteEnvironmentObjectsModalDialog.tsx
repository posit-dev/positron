/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./deleteEnvironmentObjectsModalDialog';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * DeleteEnvironmentObjectsResult interface.
 */
export interface DeleteEnvironmentObjectsResult {
	includeHiddenObjects: boolean;
}

/**
 * Shows the delete environment objects modal dialog.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showDeleteEnvironmentObjectsModalDialog = async (
	layoutService: IWorkbenchLayoutService
): Promise<DeleteEnvironmentObjectsResult | undefined> => {
	// Return a promise that resolves when the dialog is done.
	return new Promise<DeleteEnvironmentObjectsResult | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(
			layoutService.container
		);

		// The modal dialog component.
		const ModalDialog = () => {
			// Hooks.
			const [result, _setResult] = useState<DeleteEnvironmentObjectsResult>({
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
					width={400}
					height={175}
					title={localize('positronDeleteEnvironmentObjectsModalDialogTitle', "Delete All Environment Objects")}
					okButtonTitle={localize('positronYes', "Yes")}
					cancelButtonTitle={localize('positronNo', "No")}
					accept={acceptHandler} cancel={cancelHandler}>
					<VerticalStack>
						<div>Are you sure you want to delete all the objects from the environment? This operation cannot be undone.</div>
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
