/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimesManagerModalPopup';
import * as React from 'react';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { RuntimesManager } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/runtimesManager';
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

			// Render.
			return (
				<PositronModalPopup
					anchorElement={anchorElement}
					popupPosition='bottom'
					popupAlignment='right'
					width={375}
					height={'min-content'}
					dismiss={dismissHandler}
				>
					<RuntimesManager
						languageRuntimeService={languageRuntimeService}
						dismiss={dismissHandler}
					/>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalPopupReactRenderer.render(<ModalPopup />);
	});
};
