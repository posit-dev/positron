/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './twoButtonFooter.css';

// Other dependencies.
import { FooterButton } from './footerButton.js';
import * as platform from '../../../../../base/common/platform.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

/**
 * TwoButtonFooterProps interface.
 */
interface TwoButtonFooterProps {
	primaryButtonTitle: string;
	/**
	 * Marks the primary button unavailable. It stays focusable and is announced as disabled,
	 * and pressing it does nothing.
	 */
	primaryButtonDisabled?: boolean;
	/**
	 * Id of the element saying why the primary button is unavailable. Keeping the button focusable
	 * is only worth doing if there is a reason to read once the user reaches it.
	 */
	primaryButtonDescribedBy?: string;
	secondaryButtonTitle: string;
	topBorder?: boolean;
	onPrimaryButton: () => void;
	onSecondaryButton: () => void;
}

/**
 * TwoButtonFooter component.
 * @param props A TwoButtonFooterProps that contains the component properties.
 * @returns The rendered component.
 */
export const TwoButtonFooter = (props: TwoButtonFooterProps) => {
	// Primary button press handler. The button is only aria-disabled, so it is natively enabled
	// and remains the form's implicit submit target; the guard keeps a press from running the
	// action while the button reads as unavailable.
	const primaryButtonPressedHandler = () => {
		if (props.primaryButtonDisabled) {
			return;
		}

		props.onPrimaryButton();
	};

	// Primary button.
	const primaryButton = (
		<FooterButton autoFocus default ariaDescribedby={props.primaryButtonDescribedBy} ariaDisabled={props.primaryButtonDisabled} type='submit' onPressed={primaryButtonPressedHandler}>
			{props.primaryButtonTitle}
		</FooterButton>
	);

	// Secondary button.
	const secondaryButton = (
		<FooterButton onPressed={props.onSecondaryButton}>
			{props.secondaryButtonTitle}
		</FooterButton>
	);

	// Render.
	return (
		<div className={positronClassNames('two-button-footer', { 'top-border': props.topBorder })}>
			{/* On Windows, the primary button comes first; on macOS/Linux, the secondary button comes first. */}
			{platform.isWindows
				? <>{primaryButton}{secondaryButton}</>
				: <>{secondaryButton}{primaryButton}</>
			}
		</div>
	);
};
