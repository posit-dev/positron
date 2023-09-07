/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { localize } from 'vs/nls';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
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

			const widthRef = React.useRef<HTMLInputElement>(undefined!);
			const heightRef = React.useRef<HTMLInputElement>(undefined!);

			// The accept handler.
			const acceptHandler = () => {
				let result: SetPlotSizeResult | undefined = undefined;
				if (widthRef.current && widthRef.current.value.length > 0 &&
					heightRef.current && heightRef.current.value.length > 0) {
					result = {
						size: {
							width: parseInt(widthRef.current.value),
							height: parseInt(heightRef.current.value)
						}
					};
				}
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
					title={localize('positronSetPlotSizeModalDialogTitle', "Create Custom Plot Size")}
					okButtonTitle={localize('positronOk', "OK")}
					cancelButtonTitle={localize('positronCancel', "Cancel")}
					accept={acceptHandler} cancel={cancelHandler}>

					<table>
						<tr>
							<td>
								<label htmlFor='width'>
									{localize('positronPlotWidth', "Width")}
								</label>
							</td>
							<td>
								<input id='width' type='number' placeholder='100'
									ref={widthRef} />
							</td>
							<td>{localize('positronPlotPixelsAbbrev', "px")}</td>
						</tr>
						<tr>
							<td>
								<label htmlFor='height'>
									{localize('positronPlotHeight', "Height")}
								</label>
							</td>
							<td>
								<input id='height' type='number' placeholder='100'
									ref={heightRef} />
							</td>
							<td>{localize('positronPlotPixelsAbbrev', "px")}</td>
						</tr>
					</table>

				</OKCancelModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<ModalDialog />);
	});
};
