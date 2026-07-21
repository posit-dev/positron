/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './submittingOverlay.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';

/**
 * SubmittingOverlayProps interface.
 */
interface SubmittingOverlayProps {
	/** Whether the overlay should be shown. */
	readonly visible: boolean;

	/** Called when the user clicks Cancel. */
	readonly onCancel: () => void;
}

/**
 * SubmittingOverlay component. A small overlay anchored to the bottom-right of
 * the console instance viewport that shows while a code submission is being
 * prepared for execution, with a Cancel button. The parent owns the debounce
 * timer and passes `visible`.
 *
 * @param props A SubmittingOverlayProps that contains the component props.
 * @returns The rendered component.
 */
export const SubmittingOverlay = (props: SubmittingOverlayProps) => {
	if (!props.visible) {
		return null;
	}
	return (
		<div className='console-submitting-overlay' data-testid='console-submitting-overlay'>
			<span className='console-submitting-overlay-label'>
				{localize('positron.console.submitting', "Submitting...")}
			</span>
			<button className='console-submitting-overlay-cancel' onClick={props.onCancel}>
				{localize('positron.console.submitting.cancel', "Cancel")}
			</button>
		</div>
	);
};
