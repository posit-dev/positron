/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./languageSelectorModalPopup';
import * as React from 'react';
import { localize } from 'vs/nls';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { PositronModalPopupReactRenderer } from 'vs/base/browser/ui/positronModalPopup/positronModalPopupReactRenderer';

/**
 * Shows the language selector modal popup.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showLanguageSelectorModalPopup = async (
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
					width={400}
					height={175}
					accept={acceptHandler}
					cancel={cancelHandler}>
					<div style={{ margin: 8 }}>{localize('positronTestText', "The language selector UI will go here.")}</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalPopupReactRenderer.render(<ModalPopup />);
	});
};
