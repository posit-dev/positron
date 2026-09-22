/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './summaryProfilesNotice.css';

import { localize } from '../../../../../../../nls.js';
import { Button } from '../../../../../../../base/browser/ui/positronComponents/button/button.js';
import { ColumnProfilesFailure } from '../../../../../../services/positronDataExplorer/common/tableSummaryCache.js';
import { TableSummaryDataGridInstance } from '../../../../../../services/positronDataExplorer/browser/tableSummaryDataGridInstance.js';

/**
 * SummaryProfilesNoticeProps interface.
 */
export interface SummaryProfilesNoticeProps {
	readonly instance: TableSummaryDataGridInstance;
	readonly failure?: ColumnProfilesFailure;
	readonly partial: boolean;
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
 *
 * The other two cases are not retries and do not say so. A source that has gone away has nothing to
 * ask a second time, so it offers no button that could only fail. A pass that stopped on its budget
 * hasn't failed at all -- the source is answering, just slowly -- and because the profiles already
 * fetched are kept and not asked for again, the button carries on from where it stopped rather than
 * starting over. Calling that Retry would describe neither what happened nor what the button does.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const SummaryProfilesNotice = ({ instance, failure, partial, retrying }: SummaryProfilesNoticeProps) => {
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

	// Render the pass that stopped on its own budget. Its columns are not unavailable, they are
	// uncalculated, and saying so is the difference between reporting a fault and reporting a
	// choice the user can reverse.
	if (failure === 'paused') {
		const details = localize(
			'positron.dataExplorer.summaryProfilesPaused.details',
			"This data source is slow to summarize, so the remaining columns were left for now. Continue to keep calculating them."
		);

		return (
			<div className='summary-profiles-notice'>
				<div aria-hidden='true' className='codicon codicon-info' />
				<div aria-label={details} className='message' title={details}>
					{localize(
						'positron.dataExplorer.summaryProfilesPaused',
						"Summaries paused."
					)}
				</div>
				<Button
					className='retry-button'
					onPressed={() => instance.retryColumnProfiles()}
				>
					{localize('positron.dataExplorer.summaryProfilesPaused.continue', "Continue")}
				</Button>
			</div>
		);
	}

	// The short line. A pass gives up at the first chunk it cannot get through, so the columns
	// ahead of that one keep their summaries -- and where they are on screen, a flat statement that
	// the summaries are unavailable would be contradicted by the panel underneath it.
	const message = partial ?
		localize(
			'positron.dataExplorer.summaryProfilesFailed.partial',
			"Some summaries unavailable."
		) :
		localize(
			'positron.dataExplorer.summaryProfilesFailed',
			"Summaries unavailable."
		);

	// The explanation behind it, which says which summaries are missing and why.
	let details: string;
	if (failure === 'disconnected') {
		details = partial ?
			localize(
				'positron.dataExplorer.summaryProfilesFailed.disconnected.partial.details',
				"The connection to this data source was closed, so the remaining column summaries can no longer be calculated."
			) :
			localize(
				'positron.dataExplorer.summaryProfilesFailed.disconnected.details',
				"The connection to this data source was closed, so its column summaries can no longer be calculated."
			);
	} else {
		details = partial ?
			localize(
				'positron.dataExplorer.summaryProfilesFailed.partial.details',
				"Column summaries couldn't be calculated for the rest of this data. Some data sources take too long to summarize, or cannot summarize at all."
			) :
			localize(
				'positron.dataExplorer.summaryProfilesFailed.details',
				"Column summaries couldn't be calculated for this data. Some data sources take too long to summarize, or cannot summarize at all."
			);
	}

	// Render. Retrying reaches nothing while the source is gone, so a disconnected notice carries
	// no button rather than one that could only fail.
	return (
		<div className='summary-profiles-notice'>
			<div aria-hidden='true' className='codicon codicon-warning' />
			<div aria-label={details} className='message' title={details}>
				{message}
			</div>
			{failure !== 'disconnected' &&
				<Button
					className='retry-button'
					onPressed={() => instance.retryColumnProfiles()}
				>
					{localize('positron.dataExplorer.summaryProfilesFailed.retry', "Retry")}
				</Button>
			}
		</div>
	);
};
