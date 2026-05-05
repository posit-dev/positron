/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './twoButtonFooter.css';

// Other dependencies.
import { FooterButton } from './footerButton.js';
import * as platform from '../../../../../base/common/platform.js';

/**
 * TwoButtonFooterProps interface.
 */
interface TwoButtonFooterProps {
	primaryButtonTitle: string;
	secondaryButtonTitle: string;
	onPrimaryButton: () => void;
	onSecondaryButton: () => void;
}

/**
 * TwoButtonFooter component.
 * @param props A TwoButtonFooterProps that contains the component properties.
 * @returns The rendered component.
 */
export const TwoButtonFooter = (props: TwoButtonFooterProps) => {
	// Primary button. type='submit' makes this the form's implicit submit target when the footer
	// is rendered inside a <form> (e.g. inside PositronDynamicModalDialog), so pressing Enter in
	// any input triggers this button's onPressed via the browser's "click the default submit
	// button" implicit-submission behavior. Outside a form, type='submit' has no effect.
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
		<div className='two-button-footer'>
			{/* On Windows, the primary button comes first; on macOS/Linux, the secondary button comes first. */}
			{platform.isWindows
				? <>{primaryButton}{secondaryButton}</>
				: <>{secondaryButton}{primaryButton}</>
			}
		</div>
	);
};
