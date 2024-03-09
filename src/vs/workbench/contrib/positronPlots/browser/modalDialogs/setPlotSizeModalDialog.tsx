/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./setPlotSizeModalDialog';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import { ContentArea } from 'vs/base/browser/ui/positronModalDialog/components/contentArea';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

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
 * @returns A promise that resolves when the dialog is dismissed. The promise resolves to
 *   a SetPlotSizeResult if the user accepted the dialog, `null` if the user deleted the custom
 *   size, or `undefined` if the user cancelled the dialog.
 */
export const showSetPlotSizeModalDialog = async (
	customSize: IPlotSize | undefined,
	layoutService: IWorkbenchLayoutService
): Promise<SetPlotSizeResult | null | undefined> => {

	// Return a promise that resolves when the dialog is done.
	return new Promise<SetPlotSizeResult | null | undefined>((resolve) => {
		// Create the modal React renderer.
		const positronModalReactRenderer = new PositronModalReactRenderer(
			layoutService.mainContainer
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
				positronModalReactRenderer.dispose();
				resolve(result);
			};

			// The delete handler.
			const deleteHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(null);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(undefined);
			};

			// Render.
			return (
				<PositronModalDialog
					renderer={positronModalReactRenderer}
					width={350}
					height={200}
					title={localize('positronSetPlotSizeModalDialogTitle', "Custom Plot Size")}
					accept={acceptHandler}
					cancel={cancelHandler}>
					<ContentArea>

						<table>
							<tr>
								<td>
									<label htmlFor='width'>
										{localize('positronPlotWidth', "Width")}
									</label>
								</td>
								<td>
									<input id='width' type='number' placeholder='100'
										ref={widthRef} defaultValue={customSize ? customSize.width : ''} />
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
										ref={heightRef} defaultValue={customSize ? customSize.height : ''} />
								</td>
								<td>{localize('positronPlotPixelsAbbrev', "px")}</td>
							</tr>
						</table>
					</ContentArea>

					<div className='plot-size-action-bar top-separator'>
						<div className='left'>
							<button className='button action-bar-button' tabIndex={0} onClick={deleteHandler}>
								{localize('positronDeletePlotSize', "Delete")}
							</button>
						</div>
						<div className='right'>
							<button className='button action-bar-button default' tabIndex={0} onClick={acceptHandler}>
								{localize('positronOK', "OK")}
							</button>
							<button className='button action-bar-button' tabIndex={0} onClick={cancelHandler}>
								{localize('positronCancel', "Cancel")}
							</button>
						</div>
					</div>

				</PositronModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalReactRenderer.render(<ModalDialog />);
	});
};
