/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { PositronModalPopup } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js'
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronModalReactRenderer } from '../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';

const positronConsoleInfo = localize('positronConsoleInfo', "Console information");

export const ConsoleInstanceInfoButton = () => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const ref = useRef<HTMLButtonElement>(undefined!);

	const handlePressed = () => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer({
			keybindingService: positronConsoleContext.keybindingService,
			layoutService: positronConsoleContext.workbenchLayoutService,
			container: positronConsoleContext.workbenchLayoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current
		});

		renderer.render(
			<ConsoleInstanceInfoModalPopup
				anchorElement={ref.current}
				renderer={renderer}
			/>
		);
	}

	// Render.
	return (
		<ActionBarButton
			iconId='info'
			align='right'
			tooltip={positronConsoleInfo}
			ariaLabel={positronConsoleInfo}
			onPressed={handlePressed}
			ref={ref}
		/>
	)
};

interface ConsoleInstanceInfoModalPopupProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer
}

const ConsoleInstanceInfoModalPopup = (props: ConsoleInstanceInfoModalPopupProps) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Constants
	const activeConsoleInstance = positronConsoleContext.positronConsoleService.activePositronConsoleInstance;
	const session = activeConsoleInstance?.session;

	// Render.
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			height={200}
			keyboardNavigationStyle='menu'
			renderer={props.renderer}
			popupAlignment='auto'
			popupPosition='auto'
			width={400}
		>
			<div className='console-instance-info'>
				<p>Name: {session?.metadata.sessionName}</p>
				<p>ID: {session?.sessionId}</p>
				<p>State: {session?.getRuntimeState()}</p>
				<p>Path: {session?.runtimeMetadata.runtimePath}</p>
				<p>Source: {session?.runtimeMetadata.runtimeSource}</p>
			</div>
		</PositronModalPopup>
	)
};
