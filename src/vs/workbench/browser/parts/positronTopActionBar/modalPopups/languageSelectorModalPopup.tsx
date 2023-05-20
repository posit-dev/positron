/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./languageSelectorModalPopup';
import * as React from 'react';
//import { localize } from 'vs/nls';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { LanguageSelector } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/languageSelector';
import { PositronModalPopupReactRenderer } from 'vs/base/browser/ui/positronModalPopup/positronModalPopupReactRenderer';

/**
 * Shows the language selector modal popup.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showLanguageSelectorModalPopup = async (
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
			// The accept handler.
			const acceptHandler = () => {
				positronModalPopupReactRenderer.destroy();
				resolve();
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalPopupReactRenderer.destroy();
				resolve();
			};

			// Render.
			return (
				<PositronModalPopup
					anchorElement={anchorElement}
					popupPosition='bottom'
					popupAlignment='right'
					width={400}
					height={300}
					accept={acceptHandler}
					cancel={cancelHandler}
				>
					<div className='yayaya'>
						{languageRuntimeService.registeredRuntimes.map(runtime =>
							<LanguageSelector key={runtime.metadata.runtimeId} runtime={runtime} />
						)}
					</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalPopupReactRenderer.render(<ModalPopup />);
	});
};
