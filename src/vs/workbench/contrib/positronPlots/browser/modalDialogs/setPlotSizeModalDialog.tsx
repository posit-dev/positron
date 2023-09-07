/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { OKCancelModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronOKCancelModalDialog';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';
import { IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';

/**
 * SetPlotSizeResult interface.
 */
export interface SetPlotSizeResult {
	size: IPlotSize;
}

/**
 * Shows a dialog that allows the user to set a custom plot size.
 *
 * @param layoutService The layout service.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showSetPlotSizeModalDialog = async (
	layoutService: IWorkbenchLayoutService
): Promise<SetPlotSizeResult | undefined> => {

	// Return a promise that resolves when the dialog is done.
	return new Promise<SetPlotSizeResult | undefined>((resolve) => {
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer = new PositronModalDialogReactRenderer(
			layoutService.container
		);

		// The modal dialog component.
		const ModalDialog = () => {
			// Hooks.
			const [result, _setResult] = useState<SetPlotSizeResult>({
				size: {
					width: 0,
					height: 0
				}
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
					title={localize('positronSetPlotSizeModalDialogTitle', "Custom Plot Size")}
					okButtonTitle={localize('positronOk', "OK")}
					cancelButtonTitle={localize('positronCancel', "Cancel")}
					accept={acceptHandler} cancel={cancelHandler}>

					<VerticalStack>
						<div>Hellothere.</div>
					</VerticalStack>

				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
