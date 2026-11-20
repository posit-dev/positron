/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { fromNow } from '../../../../../base/common/date.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { displayTitle } from '../../common/checkpointTitle.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsMessageService, reportReadFailure } from '../checkpointsMessages.js';
import { IProposalController } from '../proposalController.js';
import { CheckpointDetails } from './checkpointDetails.js';
import { useProposalState } from './proposalCard.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';
import { useHistoryDescriptions } from './useHistoryDescriptions.js';
import { useHistoryPaging } from './useHistoryPaging.js';

/**
 * The History section: the checkpoints of the project, newest first, in pages of
 * `HISTORY_PAGE_SIZE`. Each row expands to show its description and actions. One action sends
 * every checkpoint that is not yet shared, through the proposal controller, which notes a refusal
 * that needs a review. While the agent is available and the section is
 * `visible`, a colleague's checkpoint shows a plain title and summary in place of its original
 * message, which stays under "Show git details".
 */
export const HistorySection = ({ view, visible = true }: { view: ICheckpointsViewState; visible?: boolean }) => {
	const services = usePositronReactServicesContext();
	const [expandedId, setExpandedId] = useState<string>();

	const fetchPage = useCallback(async (skip: number, limit: number) => {
		const engine = services.get(ICheckpointsService).engine;
		return engine ? engine.getHistory(skip, limit) : [];
	}, [services]);
	const showCouldNotLoad = useCallback((error: unknown) => {
		reportReadFailure(services.get(ILogService), services.get(ICheckpointsMessageService), 'The next page of history could not be read.', error);
	}, [services]);
	const { checkpoints, hasMore, loadMore } = useHistoryPaging(view.history, fetchPage, showCouldNotLoad);
	const descriptions = useHistoryDescriptions(checkpoints, visible);

	const hasUnshared = checkpoints.some(checkpoint => !checkpoint.shared);
	const branch = view.state?.branch;
	const upstream = view.state?.shared.name;

	// While a proposal exists, Send adds to it; once it was accepted or closed, there is nothing to add to.
	const { state: proposalState } = useProposalState();
	const inProposal = view.state?.proposal !== undefined;
	const proposalEnded = proposalState.kind === 'known' && (proposalState.info.state === 'accepted' || proposalState.info.state === 'closed');

	const send = async () => {
		await services.get(IProposalController).send();
		view.refresh();
	};

	return (
		<section aria-labelledby='checkpoints-history-heading' className='checkpoints-section checkpoints-history'>
			<h3 className='checkpoints-heading' id='checkpoints-history-heading'>{Strings.history.heading()}</h3>
			{checkpoints.length === 0
				? <p>{Strings.history.empty()}</p>
				: (
					<ul className='checkpoints-history-list'>
						{checkpoints.map(checkpoint => {
							const expanded = checkpoint.id === expandedId;
							const description = descriptions.get(checkpoint.id);
							const title = description?.title ?? displayTitle(checkpoint);
							return (
								<li key={checkpoint.id} className='checkpoints-history-row'>
									<Button
										ariaLabel={Strings.history.showDetails(title)}
										className='checkpoints-link checkpoints-history-title'
										onPressed={() => setExpandedId(expanded ? undefined : checkpoint.id)}
									>
										{title}
									</Button>
									<span className='checkpoints-file-note'>
										{checkpoint.authorIsMe ? Strings.history.you() : checkpoint.authorName}
									</span>
									<span className='checkpoints-file-note'>{fromNow(new Date(checkpoint.time), true)}</span>
									{!checkpoint.shared && <span className='checkpoints-file-status'>{Strings.history.notYetShared()}</span>}
									{expanded && (
										<CheckpointDetails branch={branch} checkpoint={checkpoint} description={description} upstream={upstream} onChanged={view.refresh} />
									)}
								</li>
							);
						})}
					</ul>
				)}
			{hasMore && <Button className='checkpoints-link' onPressed={loadMore}>{Strings.history.loadMore()}</Button>}
			{hasUnshared && (
				<Button className='checkpoints-button' disabled={proposalEnded} onPressed={send}>
					{inProposal ? Strings.proposals.sendMoreChanges() : Strings.actions.sendChanges()}
				</Button>
			)}
		</section>
	);
};
