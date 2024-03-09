/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./deleteAllVariablesModalDialog';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * Localized strings.
 */
const title = localize('positron.deleteAllVariablesModalDialogTitle', "Delete All Variables");
const yes = localize('positron.yes', "Yes");
const no = localize('positron.no', "No");
const text = localize('positron.deleteAllVariablesModalDialogText', "Are you sure you want to delete all variables? This operation cannot be undone.");

/**
 * DeleteAllVariablesResult interface.
 */
export interface DeleteAllVariablesResult {
	includeHiddenObjects: boolean;
}

/**
 * Shows the delete all variables modal dialog.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showDeleteAllVariablesModalDialog = async (
	layoutService: IWorkbenchLayoutService
): Promise<DeleteAllVariablesResult | undefined> => {
	// Return a promise that resolves when the dialog is done.
	return new Promise<DeleteAllVariablesResult | undefined>((resolve) => {
		// Create the modal React renderer.
		const positronModalReactRenderer = new PositronModalReactRenderer(
			layoutService.mainContainer
		);

		// The modal dialog component.
		const ModalDialog = () => {
			// Hooks.
			const [result, _setResult] = useState<DeleteAllVariablesResult>({
				includeHiddenObjects: false
			});

			// The accept handler.
			const acceptHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(result);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(undefined);
			};

			// Render.
			return (
				<OKCancelModalDialog
					renderer={positronModalReactRenderer}
					width={375}
					height={175}
					title={title}
					okButtonTitle={yes}
					cancelButtonTitle={no}
					accept={acceptHandler} cancel={cancelHandler}>

					<VerticalStack>
						<div>{text}</div>
						{/* Disabled for Private Alpha. */}
						{/* <Checkbox label='Include hidden objects' onChanged={checked => setResult({ ...result, includeHiddenObjects: checked })} /> */}
					</VerticalStack>

				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalReactRenderer.render(<ModalDialog />);
	});
};
