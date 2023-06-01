/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpretersManagerModalPopup';
import * as React from 'react';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { InterpreterGroups } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterGroups';
import { PositronModalPopupReactRenderer } from 'vs/base/browser/ui/positronModalPopup/positronModalPopupReactRenderer';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * Shows the interpreters manager modal popup.
 * @param languageRuntimeService The language runtime service.
 * @param container The container of the application.
 * @param anchorElement The anchor element for the runtimes manager modal popup.
 * @param onStartRuntime The start runtime event handler.
 * @param onActivateRuntime The activate runtime event handler.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showInterpretersManagerModalPopup = async (
	languageRuntimeService: ILanguageRuntimeService,
	container: HTMLElement,
	anchorElement: HTMLElement,
	onStartRuntime: (runtime: ILanguageRuntime) => Promise<void>,
	onActivateRuntime: (runtime: ILanguageRuntime) => Promise<void>
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

			const activateRuntimeHandler = async (runtime: ILanguageRuntime): Promise<void> => {
				await onActivateRuntime(runtime);

				positronModalPopupReactRenderer.destroy();
				resolve();
			};

			// Render.
			return (
				<PositronModalPopup
					anchorElement={anchorElement}
					popupPosition='bottom'
					popupAlignment='right'
					width={350}
					height={'min-content'}
					onDismiss={dismissHandler}
				>
					<InterpreterGroups
						languageRuntimeService={languageRuntimeService}
						onStartRuntime={onStartRuntime}
						onActivateRuntime={activateRuntimeHandler}
					/>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalPopupReactRenderer.render(<ModalPopup />);
	});
};
