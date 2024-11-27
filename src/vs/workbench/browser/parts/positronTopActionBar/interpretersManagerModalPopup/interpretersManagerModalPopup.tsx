/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './interpretersManagerModalPopup.css';

// React.
import React from 'react';

// Other dependencies.
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { PositronModalPopup } from '../../../positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { InterpreterGroups } from './interpreterGroups.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

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
	anchorElement: HTMLElement;
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
			anchorElement={props.anchorElement}
			popupPosition='bottom'
			popupAlignment='right'
			width={375}
			height={'min-content'}
			keyboardNavigationStyle='menu'
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
