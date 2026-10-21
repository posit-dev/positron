/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './footerButton.css';

// React.
import { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * How long a busy button waits before showing its spinner, so a quick operation completes without
 * the spinner flashing on and off.
 */
const BUSY_SPINNER_DELAY_MS = 250;

/**
 * FooterButtonProps interface.
 */
interface FooterButtonProps {
	autoFocus?: boolean;
	/**
	 * Whether the button's action is in progress. A busy button ignores presses at once, staying
	 * focusable so a keyboard user keeps their place, and shows a spinner if the action is still in
	 * progress after a short delay.
	 */
	busy?: boolean;
	default?: boolean;
	/**
	 * Whether this button performs a destructive action, which fills it with the destructive red.
	 * An alternative to `default`, not a modifier on it: both set the button's fill, so a button is
	 * one or the other.
	 */
	destructive?: boolean;
	disabled?: boolean;
	type?: 'button' | 'submit';
	onPressed: () => void;
}

/**
 * FooterButton component.
 * @param props A FooterButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const FooterButton = (props: PropsWithChildren<FooterButtonProps>) => {
	// Whether the busy spinner is showing.
	const [showSpinner, setShowSpinner] = useState(false);

	// Show the spinner once the button has been busy for the delay; hide it as soon as it isn't.
	useEffect(() => {
		if (!props.busy) {
			setShowSpinner(false);
			return;
		}
		const timeout = setTimeout(() => setShowSpinner(true), BUSY_SPINNER_DELAY_MS);
		return () => clearTimeout(timeout);
	}, [props.busy]);

	return (
		<Button
			ariaDisabled={props.busy}
			autoFocus={props.autoFocus}
			className={positronClassNames(
				'dialog-button',
				'footer-button',
				{ 'default': props.default },
				{ 'destructive': props.destructive }
			)}
			disabled={props.disabled}
			type={props.type}
			onPressed={props.onPressed}
		>
			{showSpinner && <span aria-hidden='true' className='codicon codicon-loading codicon-modifier-spin' />}
			{props.children}
		</Button>
	);
};
