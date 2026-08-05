/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './destructiveTwoButtonFooter.css';

// Other dependencies.
import { FooterButton } from './footerButton.js';
import * as platform from '../../../../../base/common/platform.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

/**
 * DestructiveTwoButtonFooterProps interface.
 */
interface DestructiveTwoButtonFooterProps {
	primaryButtonTitle: string;
	secondaryButtonTitle: string;
	topBorder?: boolean;
	onPrimaryButton: () => void;
	onSecondaryButton: () => void;
}

/**
 * DestructiveTwoButtonFooter component. A two button footer whose primary button performs a
 * destructive action -- removing a saved connection, discarding work -- and so is filled with the
 * destructive red rather than the accent color a default button gets, and does not take the opening
 * focus the way a plain two button footer's primary does.
 * @param props A DestructiveTwoButtonFooterProps that contains the component properties.
 * @returns The rendered component.
 */
export const DestructiveTwoButtonFooter = (props: DestructiveTwoButtonFooterProps) => {
	// Primary button. Destructive rather than default: the two treatments are alternatives, and the
	// red fill is what marks the action as one the user cannot take back. Deliberately not focused --
	// see the secondary button below.
	const primaryButton = (
		<FooterButton destructive type='submit' onPressed={props.onPrimaryButton}>
			{props.primaryButtonTitle}
		</FooterButton>
	);

	// Secondary button. It takes the focus rather than the primary, unlike a plain two button footer:
	// the primary action here cannot be taken back, so Enter and Escape should both back out of the
	// dialog and taking the action should cost a deliberate click or Tab.
	const secondaryButton = (
		<FooterButton autoFocus onPressed={props.onSecondaryButton}>
			{props.secondaryButtonTitle}
		</FooterButton>
	);

	// Render.
	return (
		<div className={positronClassNames('destructive-two-button-footer', { 'top-border': props.topBorder })}>
			{/* On Windows, the primary button comes first; on macOS/Linux, the secondary button comes first. */}
			{platform.isWindows
				? <>{primaryButton}{secondaryButton}</>
				: <>{secondaryButton}{primaryButton}</>
			}
		</div>
	);
};
