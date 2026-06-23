/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './threeButtonFooter.css';

// Other dependencies.
import { FooterButton } from './footerButton.js';
import * as platform from '../../../../../base/common/platform.js';

/**
 * ThreeButtonFooterProps interface.
 */
interface ThreeButtonFooterProps {
	leftButtonTitle: string;
	primaryButtonTitle: string;
	secondaryButtonTitle: string;
	onLeftButton: () => void;
	onPrimaryButton: () => void;
	onSecondaryButton: () => void;
}

/**
 * ThreeButtonFooter component.
 * Renders the left button on the left edge of the footer and the secondary and primary buttons
 * grouped on the right, matching the platform-specific ordering of TwoButtonFooter.
 * @param props A ThreeButtonFooterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ThreeButtonFooter = (props: ThreeButtonFooterProps) => {
	// Left button.
	const leftButton = (
		<FooterButton onPressed={props.onLeftButton}>
			{props.leftButtonTitle}
		</FooterButton>
	);

	// Primary button.
	const primaryButton = (
		<FooterButton autoFocus default type='submit' onPressed={props.onPrimaryButton}>
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
		<div className='three-button-footer'>
			{leftButton}
			<div className='three-button-footer-right'>
				{/* On Windows, the primary button comes first; on macOS/Linux, the secondary button comes first. */}
				{platform.isWindows
					? <>{primaryButton}{secondaryButton}</>
					: <>{secondaryButton}{primaryButton}</>
				}
			</div>
		</div>
	);
};
