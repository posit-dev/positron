/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./deleteEnvironmentVariablesModalDialog';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * DeleteEnvironmentVariablesResult interface.
 */
export interface DeleteEnvironmentVariablesResult {
	includeHiddenVariables: boolean;
}

/**
 * Shows the delete environment variables modal dialog.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showDeleteEnvironmentVariablesModalDialog = async (
	layoutService: IWorkbenchLayoutService
): Promise<DeleteEnvironmentVariablesResult | undefined> => {
	// Return a promise that resolves when the dialog is done.
	return new Promise<DeleteEnvironmentVariablesResult | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(
			layoutService.container
		);

		// The modal dialog component.
		const ModalDialog = () => {
			// Hooks.
			const [result, _setResult] = useState<DeleteEnvironmentVariablesResult>({
				includeHiddenVariables: false
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
					title={localize('positronDeleteEnvironmentVariablesModalDialogTitle', "Delete All Environment Variables")}
					okButtonTitle={localize('positronYes', "Yes")}
					cancelButtonTitle={localize('positronNo', "No")}
					accept={acceptHandler} cancel={cancelHandler}>
					<VerticalStack>
						<div>Are you sure you want to delete all the variables from the environment? This operation cannot be undone.</div>
						{/* Disabled for Private Alpha. */}
						{/* <Checkbox label='Include hidden variables' onChanged={checked => setResult({ ...result, includeHiddenVariables: checked })} /> */}
					</VerticalStack>
				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
