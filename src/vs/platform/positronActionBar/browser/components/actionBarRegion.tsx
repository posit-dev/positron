/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarRegion.css';

// React.
import React, { PropsWithChildren, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { ActionBarButton } from './actionBarButton.js';
import { PositronActionBarContextProvider, usePositronActionBarContext } from '../positronActionBarContext.js';
import { optionalValue, positronClassNames } from '../../../../base/common/positronUtilities.js';
import { PositronModalReactRenderer } from '../../../../workbench/browser/positronModalReactRenderer/positronModalReactRenderer.js';
import { PositronModalPopup } from '../../../../workbench/browser/positronComponents/positronModalPopup/positronModalPopup.js';

/**
 * ActionBarRegionProps interface.
 */
interface ActionBarRegionProps {
	width?: number;
	location: 'left' | 'center' | 'right';
	justify?: 'left' | 'center' | 'right';
}






interface FooProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer;
}

const FooPopup = (props: PropsWithChildren<FooProps>) => {
	// Render.
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			fixedHeight={true}
			height='min-content'
			keyboardNavigationStyle='menu'
			popupAlignment='auto'
			popupPosition='auto'
			renderer={props.renderer}
			width='max-content'
		>
			<div style={{ flexDirection: 'column', margin: '4px 2px' }}>
				{props.children}
			</div>
		</PositronModalPopup>
	)
};



/**
 * ActionBarRegionProps component.
 * @param props An ActionBarRegionProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarRegion = (props: PropsWithChildren<ActionBarRegionProps>) => {
	// Context hooks.
	const context = usePositronActionBarContext();

	const ref = useRef<HTMLButtonElement>(undefined!);

	// Create the class names.
	const classNames = positronClassNames(
		`action-bar-region action-bar-region-${props.location}`,
		`action-bar-region-justify-${props.justify || props.location}`
	);

	if (props.location === 'right' && context.width && context.width < 500) {
		return (
			<ActionBarButton
				ref={ref}
				ariaLabel={'Yaya yaya'}
				iconId='toolbar-more'
				tooltip={'Yaya yaya'}
				onPressed={async () => {
					// Create the renderer.
					const renderer = new PositronModalReactRenderer({
						keybindingService: context.keybindingService,
						layoutService: context.layoutService,
						container: context.layoutService.getContainer(DOM.getWindow(ref.current)),
						parent: ref.current
					});

					// Show the custom folder modal popup.
					renderer.render(
						<PositronActionBarContextProvider {...context} renderer={renderer}>
							<FooPopup anchorElement={ref.current} renderer={renderer}>
								{props.children}
							</FooPopup>
						</PositronActionBarContextProvider>
					);
				}}
			/>
		);
	}

	// Render.
	return (
		<div
			className={classNames}
			style={{
				width: optionalValue(props.width, 'auto'),
				minWidth: optionalValue(props.width, 'auto')
			}}
		>
			{props.children}
		</div>
	);
};
