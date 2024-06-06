/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

import * as DOM from 'vs/base/browser/dom';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { WelcomeButton } from 'vs/workbench/contrib/welcomeGettingStarted/browser/positronWelcomeButton';

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
