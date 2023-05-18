/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./languageSelectorModalPopup';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { PositronModalPopupReactRenderer } from 'vs/base/browser/ui/positronModalPopup/positronModalPopupReactRenderer';

/**
 * DeleteAllObjectsResult interface.
 */
export interface DeleteAllObjectsResult {
	includeHiddenObjects: boolean;
}

/**
 * Shows the language selector modal popup.
 * @param layoutService The layout service.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showLanguageSelectorModalPopup = async (
	layoutService: ILayoutService,
	anchorElement: HTMLElement,
): Promise<DeleteAllObjectsResult | undefined> => {
	// Return a promise that resolves when the popup is done.
	return new Promise<DeleteAllObjectsResult | undefined>(resolve => {
		// Create the modal popup React renderer.
		const positronModalPopupReactRenderer = new PositronModalPopupReactRenderer(
			layoutService.container
		);

		// The modal popup component.
		const ModalPopup = () => {
			// Hooks.
			const [result, _setResult] = useState<DeleteAllObjectsResult>({
				includeHiddenObjects: false
			});

			// The accept handler.
			const acceptHandler = () => {
				positronModalPopupReactRenderer.destroy();
				resolve(result);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalPopupReactRenderer.destroy();
				resolve(undefined);
			};

			// Render.
			return (
				<PositronModalPopup
					anchorElement={anchorElement}
					width={400}
					height={175}
					accept={acceptHandler}
					cancel={cancelHandler}>
					<div style={{ margin: 8 }}>{localize('positronHellowWorld', "Hello, World!")}</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalPopupReactRenderer.render(<ModalPopup />);
	});
};
