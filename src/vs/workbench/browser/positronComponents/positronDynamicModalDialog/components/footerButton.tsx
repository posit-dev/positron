/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './footerButton.css';

// React.
import { PropsWithChildren } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * FooterButtonProps interface.
 */
interface FooterButtonProps {
	/**
	 * Marks the button unavailable while leaving it in the tab order, so a screen reader can
	 * still reach it and be told it is unavailable. Prefer this over `disabled`, which removes
	 * the button from the tab order entirely. Presses do nothing either way.
	 */
	ariaDisabled?: boolean;
	autoFocus?: boolean;
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
	return (
		<Button
			ariaDisabled={props.ariaDisabled}
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
			{props.children}
		</Button>
	);
};
