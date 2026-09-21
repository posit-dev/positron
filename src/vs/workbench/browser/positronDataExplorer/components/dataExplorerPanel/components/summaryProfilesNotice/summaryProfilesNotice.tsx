/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './summaryProfilesNotice.css';

import { localize } from '../../../../../../../nls.js';
import { Button } from '../../../../../../../base/browser/ui/positronComponents/button/button.js';
import { TableSummaryDataGridInstance } from '../../../../../../services/positronDataExplorer/browser/tableSummaryDataGridInstance.js';

/**
 * SummaryProfilesNoticeProps interface.
 */
export interface SummaryProfilesNoticeProps {
	readonly instance: TableSummaryDataGridInstance;
	readonly retrying: boolean;
}

/**
 * SummaryProfilesNotice component. Shown above the column list when the backend could not compute
 * the columns' summary statistics, and for as long as a retry of them is running.
 *
 * The panel keeps the column names and types it did get, so this states the shortfall once, at the
 * top, rather than leaving the user to infer it from a column of empty summaries. The line is kept
 * short enough to fit the narrowest the panel can be dragged to, with the fuller explanation
 * behind it.
 *
 * Retrying is offered because a source that timed out may well answer on a second attempt, but it
 * is the user's call to spend that time again. This row stays in place while the retry runs, which
 * is what keeps the grid below it from resizing and cancelling the retry partway.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const SummaryProfilesNotice = ({ instance, retrying }: SummaryProfilesNoticeProps) => {
	// Render the retry in progress.
	if (retrying) {
		return (
			<div className='summary-profiles-notice'>
				<div aria-hidden='true' className='codicon codicon-loading codicon-modifier-spin' />
				<div className='message' role='status'>
					{localize(
						'positron.dataExplorer.summaryProfilesNotice.retrying',
						"Calculating summaries..."
					)}
				</div>
			</div>
		);
	}

	// The short line, and the explanation behind it.
	const message = localize(
		'positron.dataExplorer.summaryProfilesFailed',
		"Summaries unavailable."
	);
	const details = localize(
		'positron.dataExplorer.summaryProfilesFailed.details',
		"Column summaries couldn't be calculated for this data. Some data sources take too long to summarize, or cannot summarize at all."
	);

	// Render.
	return (
		<div className='summary-profiles-notice'>
			<div aria-hidden='true' className='codicon codicon-warning' />
			<div aria-label={details} className='message' title={details}>
				{message}
			</div>
			<Button
				className='retry-button'
				onPressed={() => instance.retryColumnProfiles()}
			>
				{localize('positron.dataExplorer.summaryProfilesFailed.retry', "Retry")}
			</Button>
		</div>
	);
};
