/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./interpretersManagerModalPopup';
import * as React from 'react';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { InterpreterGroups } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroups';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';

/**
 * Shows the interpreters manager modal popup.
 *
 * @param languageRuntimeService The language runtime service.
 * @param runtimeStartupService The runtime stasrtup service.
 * @param runtimeSessionService The runtime session service.
 * @param containerElement The container element.
 * @param anchorElement The anchor element for the modal popup.
 * @param onStartRuntime The start runtime event handler.
 * @param onActivateRuntime The activate runtime event handler.
 *
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showInterpretersManagerModalPopup = async (
	languageRuntimeService: ILanguageRuntimeService,
	runtimeStartupService: IRuntimeStartupService,
	runtimeSessionService: IRuntimeSessionService,
	containerElement: HTMLElement,
	anchorElement: HTMLElement,
	onStartRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>,
	onActivateRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>
): Promise<void> => {
	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Create the modal React renderer.
		const positronModalReactRenderer = new PositronModalReactRenderer(containerElement);

		// The modal popup component.
		const ModalPopup = () => {
			/**
			 * Dismisses the popup.
			 */
			const dismiss = () => {
				positronModalReactRenderer.dispose();
				resolve();
			};

			/**
			 * onActivateRuntime event handler.
			 * @param runtime An ILanguageRuntime representing the runtime to activate.
			 */
			const activateRuntimeHandler = async (runtime: ILanguageRuntimeMetadata): Promise<void> => {
				// Activate the runtime.
				await onActivateRuntime(runtime);

				// Dismiss the popup.
				dismiss();
			};

			// Render.
			return (
				<PositronModalPopup
					renderer={positronModalReactRenderer}
					containerElement={containerElement}
					anchorElement={anchorElement}
					popupPosition='bottom'
					popupAlignment='right'
					width={375}
					height={'min-content'}
					keyboardNavigation='menu'
					onDismiss={() => dismiss()}
				>
					<InterpreterGroups
						languageRuntimeService={languageRuntimeService}
						runtimeAffiliationService={runtimeStartupService}
						runtimeSessionService={runtimeSessionService}
						onStartRuntime={onStartRuntime}
						onActivateRuntime={activateRuntimeHandler}
					/>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalReactRenderer.render(<ModalPopup />);
	});
};
