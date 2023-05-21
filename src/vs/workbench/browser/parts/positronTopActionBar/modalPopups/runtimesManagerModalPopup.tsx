/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimesManagerModalPopup';
import * as React from 'react';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { RunningRuntime } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/runningRuntime';
import { PositronModalPopupReactRenderer } from 'vs/base/browser/ui/positronModalPopup/positronModalPopupReactRenderer';

/**
 * Shows the runtimes manager modal popup.
 * @param languageRuntimeService The language runtime service.
 * @param container The container of the application.
 * @param anchorElement The anchor element for the runtimes manager modal popup.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showRuntimesManagerModalPopup = async (
	languageRuntimeService: ILanguageRuntimeService,
	container: HTMLElement,
	anchorElement: HTMLElement,
): Promise<void> => {
	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Create the modal popup React renderer.
		const positronModalPopupReactRenderer = new PositronModalPopupReactRenderer(container);

		// The modal popup component.
		const ModalPopup = () => {
			// The dismiss handler.
			const dismissHandler = () => {
				positronModalPopupReactRenderer.destroy();
				resolve();
			};

			/**
			 * Calculates the height of the popup.
			 * @returns The height of the popup.
			 */
			const calculateHeight = () => {
				return 8 +														// Margin.
					(languageRuntimeService.runningRuntimes.length * 75) +		// Runtimes.
					((languageRuntimeService.runningRuntimes.length - 1) * 4);	// Separators.
			};

			// Render.
			return (
				<PositronModalPopup
					anchorElement={anchorElement}
					popupPosition='bottom'
					popupAlignment='right'
					width={400}
					height={calculateHeight()}
					dismiss={dismissHandler}
				>
					<div className='running-runtimes'>
						{languageRuntimeService.runningRuntimes.map((runtime, index, runningRuntimes) => (
							<>
								<RunningRuntime
									key={runtime.metadata.runtimeId}
									languageRuntimeService={languageRuntimeService}
									runtime={runtime}
									dismiss={dismissHandler} />
								{index < runningRuntimes.length - 1 && <div className='separator' />}
							</>
						))}
					</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalPopupReactRenderer.render(<ModalPopup />);
	});
};
