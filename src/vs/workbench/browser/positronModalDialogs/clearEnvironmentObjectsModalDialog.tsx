/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./clearEnvironmentObjectsModalDialog';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { Checkbox } from 'vs/base/browser/ui/positronModalDialog/components/checkbox';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';

/**
 * NewWorkspaceResult interface.
 */
export interface ClearEnvironmentObjectsResult {
	includeHiddenObjects: boolean;
}

/**
 * Shows the clear environment objects modal dialog.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showClearEnvironmentObjectsModalDialog = async (layoutService: IWorkbenchLayoutService): Promise<ClearEnvironmentObjectsResult | undefined> => {
	// Return a promise that resolves when the dialog is done.
	return new Promise<ClearEnvironmentObjectsResult | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(layoutService.container);

		// The modal dialog component.
		const ModalDialog = () => {
			// Hooks.
			const [clearEnvironmentObjectsResult, setClearEnvironmentObjectsResult] = useState<ClearEnvironmentObjectsResult>({
				includeHiddenObjects: false
			});

			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(clearEnvironmentObjectsResult);
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
					height={195}
					title={localize('positronClearEnvironmentObjectsModalDialogTitle', "Clear All Environment Objects")}
					okButtonTitle={localize('positronYes', "Yes")}
					cancelButtonTitle={localize('positronNo', "No")}
					accept={acceptHandler} cancel={cancelHandler}>
					<VerticalStack>
						<div>Are you sure you want to clear all the objects from the environment? This operation cannot be undone.</div>
						<Checkbox label='Include hidden objects' onChanged={checked => setClearEnvironmentObjectsResult({ ...clearEnvironmentObjectsResult, includeHiddenObjects: checked })} />
					</VerticalStack>
				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
