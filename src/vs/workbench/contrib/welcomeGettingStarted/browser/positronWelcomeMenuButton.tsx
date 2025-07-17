/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { PositronModalPopup } from '../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { WelcomeButton } from './positronWelcomeButton.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

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
}

export function WelcomeMenuButton(props: WelcomeMenuButtonProps) {
	const services = usePositronReactServicesContext();
	const ref = React.createRef<HTMLDivElement>();
	const showPopup = React.useCallback(() => {
		if (ref.current === null) {
			return;
		}

		const renderer = new PositronModalReactRenderer({
			container: services.workbenchLayoutService.getContainer(DOM.getWindow(ref.current)),
			parent: ref.current,
		});

		renderer.render(
			<PositronModalPopup
				anchorElement={ref.current}
				height={'auto'}
				keyboardNavigationStyle='menu'
				popupAlignment='left'
				popupPosition='bottom'
				renderer={renderer}
				width={300}
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
	}, [props.actions, ref, services.workbenchLayoutService]);

	// Render.
	return (
		<WelcomeButton
			ref={ref}
			ariaLabel={props.ariaLabel}
			codicon={props.codicon}
			label={props.label}
			onPressed={showPopup}
		/>
	);
}
