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
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { InterpreterGroups } from 'vs/workbench/browser/parts/positronTopActionBar/interpretersManagerModalPopup/interpreterGroups';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * InterpretersManagerModalPopupProps interface.
 */
interface InterpretersManagerModalPopupProps {
	keybindingService: IKeybindingService;
	languageRuntimeService: ILanguageRuntimeService;
	layoutService: ILayoutService;
	runtimeSessionService: IRuntimeSessionService;
	runtimeStartupService: IRuntimeStartupService;
	renderer: PositronModalReactRenderer;
	anchor: HTMLElement;
	onStartRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
	onActivateRuntime: (runtime: ILanguageRuntimeMetadata) => Promise<void>;
}

/**
 * InterpretersManagerModalPopup component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const InterpretersManagerModalPopup = (props: InterpretersManagerModalPopupProps) => {
	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchor={props.anchor}
			popupPosition='bottom'
			popupAlignment='right'
			width={375}
			height={'min-content'}
			keyboardNavigation='menu'
		>
			<InterpreterGroups
				languageRuntimeService={props.languageRuntimeService}
				runtimeAffiliationService={props.runtimeStartupService}
				runtimeSessionService={props.runtimeSessionService}
				onStartRuntime={props.onStartRuntime}
				onActivateRuntime={async (runtime) => {
					// Activate the runtime.
					await props.onActivateRuntime(runtime);

					// Dismiss the popup.
					props.renderer.dispose();
				}}
			/>
		</PositronModalPopup>
	);
};
