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
		<div className={positronClassNames('two-button-footer', { 'top-border': props.topBorder })}>
			{/* On Windows, the primary button comes first; on macOS/Linux, the secondary button comes first. */}
			{platform.isWindows
				? <>{primaryButton}{secondaryButton}</>
				: <>{secondaryButton}{primaryButton}</>
			}
		</div>
	);
};
