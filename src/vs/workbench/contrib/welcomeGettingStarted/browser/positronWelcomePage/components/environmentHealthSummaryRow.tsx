/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize } from '../../../../../../nls.js';

export interface EnvironmentHealthSummaryRowProps {
	/** Whether any language has a check or a fix running. */
	readonly busy: boolean;
}

/**
 * EnvironmentHealthSummaryRow component. What the environment setup card
 * collapses to when every language it checks has passed.
 *
 * Deliberately inert. Nothing in the card is worth acting on once every check
 * passed, and as a control it read badly both ways: nothing said it could be
 * pressed, and pressing it had no way back to this row.
 * @param props An EnvironmentHealthSummaryRowProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentHealthSummaryRow = ({ busy }: EnvironmentHealthSummaryRowProps) => {
	// Render.
	return (
		<div className='environment-health-summary-row'>
			<span aria-hidden='true' className='environment-health-summary-icon codicon codicon-pass' />
			<span className='environment-health-summary-label'>
				{localize('positron.welcome.environmentSetupReady', "You are all set up")}
			</span>
			{/*
				A recheck keeps the previous results, so this row stays in place while
				one runs and has to report it itself. Without this, pressing recheck
				above would look like nothing happening.
			*/}
			{busy && <span aria-hidden='true' className='environment-health-progress' data-testid='environment-health-summary-progress' />}
		</div>
	);
};
