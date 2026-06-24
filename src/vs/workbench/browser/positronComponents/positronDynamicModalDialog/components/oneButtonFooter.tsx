/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './oneButtonFooter.css';

// Other dependencies.
import { FooterButton } from './footerButton.js';

/**
 * OneButtonFooterProps interface.
 */
interface OneButtonFooterProps {
	buttonTitle: string;
	onButton: () => void;
}

/**
 * OneButtonFooter component. A single right-aligned default button, used by acknowledge-style
 * dialogs (e.g. an OK / Close / Got it button). The button is type='submit' so Enter activates it
 * via the dialog's wrapping form.
 * @param props A OneButtonFooterProps that contains the component properties.
 * @returns The rendered component.
 */
export const OneButtonFooter = (props: OneButtonFooterProps) => {
	return (
		<div className='one-button-footer'>
			<FooterButton autoFocus default type='submit' onPressed={props.onButton}>
				{props.buttonTitle}
			</FooterButton>
		</div>
	);
};
