/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ThemeIcon as ThemeIconType } from '../../../../base/common/themables.js';
import { ThemeIcon } from '../../../../platform/positronActionBar/browser/components/icon.js';
import { ActionButton } from '../../positronNotebook/browser/utilityComponents/ActionButton.js';

// WelcomeButton props
interface WelcomeButtonProps {
	label: string;
	icon: ThemeIconType;
	ariaLabel: string;
	onPressed: () => void;
}

/**
 * Inner component to ref the WelcomeButton.
 * @param props The WelcomeButtonProps
 * @param ref The ref to the button (HTMLDivElement)
 * @returns The rendered component.
 */
export function WelcomeButtonInner(props: WelcomeButtonProps, ref?: React.ForwardedRef<HTMLDivElement>) {

	// Render.
	return (
		<ActionButton
			ariaLabel={props.ariaLabel}
			className='positron-welcome-button'
			onPressed={props.onPressed}
		>
			<div ref={ref} className='button-container'>
				<ThemeIcon className='button-icon' icon={props.icon} />
				<div className='action-label'>
					{props.label}
				</div>
			</div>
		</ActionButton>
	);
}

export const WelcomeButton = React.forwardRef(WelcomeButtonInner);
