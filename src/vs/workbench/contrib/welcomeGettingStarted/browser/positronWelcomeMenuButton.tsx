/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { PositronModalPopup } from '../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { WelcomeButton } from './positronWelcomeButton.js';

export interface WelcomeMenuButtonAction {
	id: string;
	renderIcon: () => React.ReactElement;
	label: string;
	run: () => void;
	tooltip: string;
}

// WelcomeMenuButton props
interface WelcomeMenuButtonProps {
	label: string;
	codicon: string;
	ariaLabel: string;
	actions: WelcomeMenuButtonAction[];
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
}

export function WelcomeMenuButton(props: WelcomeMenuButtonProps) {
	const ref = React.createRef<HTMLDivElement>();
	const showPopup = React.useCallback(() => {
		if (ref.current === null) {
			return;
		}

		const renderer = new PositronModalReactRenderer({
			keybindingService: props.keybindingService,
			layoutService: props.layoutService,
			container: props.layoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current,
		});

		renderer.render(
			<PositronModalPopup
				renderer={renderer}
				anchorElement={ref.current}
				popupPosition='bottom'
				popupAlignment='left'
				width={300}
				height={'min-content'}
				keyboardNavigationStyle='menu'
			>
				<div className='welcome-page-start menu-button-container'>
					{props.actions.map((action, index) => (
						<div key={index} className='positron-welcome-menu-item' onClick={() => {
							action.run();
							renderer.dispose();
						}}>
							<div className='icon'>
								{action.renderIcon()}
							</div>
							<div className='label'>
								{action.label}
							</div>
						</div>
					))}
				</div>
			</PositronModalPopup>
		);
	}, [props, ref]);

	// Render.
	return (
		<WelcomeButton
			label={props.label}
			codicon={props.codicon}
			ariaLabel={props.ariaLabel}
			onPressed={showPopup}
			ref={ref}
		/>
	);
}
