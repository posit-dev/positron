/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

import { ActionButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/ActionButton';

// WelcomeButton props
interface WelcomeButtonProps {
	label: string;
	codicon: string;
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
			className='positron-welcome-button'
			ariaLabel={props.ariaLabel}
			onPressed={props.onPressed}
		>
			<div className='button-container' ref={ref}>
				<div className={`button-icon codicon codicon-${props.codicon}`} />
				<div className='action-label'>
					{props.label}
				</div>
			</div>
		</ActionButton>
	);
}

export const WelcomeButton = React.forwardRef(WelcomeButtonInner);
