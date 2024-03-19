/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./interpretersManagerModalPopup';

// React.
import * as React from 'react';

// Other dependencies.
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { InterpreterGroups } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroups';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * Shows the interpreters manager modal popup.
 * @param options The interpreters manager options.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const showInterpretersManagerModalPopup = async (options: {
	keybindingService: IKeybindingService;
	languageRuntimeService: ILanguageRuntimeService;
	layoutService: ILayoutService;
	runtimeStartupService: IRuntimeStartupService;
	runtimeSessionService: IRuntimeSessionService;
	container: HTMLElement;
	anchor: HTMLElement;
	onStartRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
}): Promise<void> => {
	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container: options.container,
			keyEventProcessor: new StopCommandsKeyEventProcessor(options)
		});

		// The modal popup component.
		const ModalPopup = () => {
			/**
			 * Dismisses the popup.
			 */
			const dismiss = () => {
				renderer.dispose();
				resolve();
			};

			/**
			 * onActivateRuntime event handler.
			 * @param runtime An ILanguageRuntime representing the runtime to activate.
			 */
			const activateRuntimeHandler = async (runtime: ILanguageRuntimeMetadata): Promise<void> => {
				// Activate the runtime.
				await options.onActivateRuntime(runtime);

				// Dismiss the popup.
				dismiss();
			};

			// Render.
			return (
				<PositronModalPopup
					renderer={renderer}
					containerElement={options.container}
					anchorElement={options.anchor}
					popupPosition='bottom'
					popupAlignment='right'
					width={375}
					height={'min-content'}
					keyboardNavigation='menu'
					onDismiss={() => dismiss()}
				>
					<InterpreterGroups
						languageRuntimeService={options.languageRuntimeService}
						runtimeAffiliationService={options.runtimeStartupService}
						runtimeSessionService={options.runtimeSessionService}
						onStartRuntime={options.onStartRuntime}
						onActivateRuntime={activateRuntimeHandler}
					/>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		renderer.render(<ModalPopup />);
	});
};
