/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { fromNow } from '../../../../../base/common/date.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { CheckpointDetails } from './checkpointDetails.js';
import { HISTORY_PAGE_SIZE, ICheckpointsViewState } from './useCheckpointsState.js';
import { useRunAction } from './useRunAction.js';

/**
 * The History section: the checkpoints of the project, newest first, in pages of
 * `HISTORY_PAGE_SIZE`. Each row expands to show its description and actions. One action sends
 * every checkpoint that is not yet shared.
 */
export const HistorySection = ({ view }: { view: ICheckpointsViewState }) => {
	const services = usePositronReactServicesContext();
	const runAction = useRunAction();
	const [older, setOlder] = useState<ICheckpoint[]>([]);
	const [exhausted, setExhausted] = useState(false);
	const [expandedId, setExpandedId] = useState<string>();

	// A new first page makes the older pages stale.
	useEffect(() => {
		setOlder([]);
		setExhausted(false);
	}, [view.history]);

	const checkpoints = [...view.history, ...older];
	const hasMore = !exhausted && checkpoints.length > 0 && checkpoints.length % HISTORY_PAGE_SIZE === 0;
	const hasUnshared = checkpoints.some(checkpoint => !checkpoint.shared);
	const branch = view.state?.branch;
	const upstream = branch !== undefined && view.state?.shared.exists ? `origin/${branch}` : undefined;

	const loadMore = async () => {
		const engine = services.get(ICheckpointsService).engine;
		if (!engine) {
			return;
		}
		const page = await engine.getHistory(checkpoints.length, HISTORY_PAGE_SIZE);
		setOlder([...older, ...page]);
		setExhausted(page.length < HISTORY_PAGE_SIZE);
	};

	const send = async () => {
		await runAction('no-guard', engine => engine.sendChanges());
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
							return (
								<li key={checkpoint.id} className='checkpoints-history-row'>
									<Button
										ariaLabel={Strings.history.showDetails(checkpoint.title)}
										className='checkpoints-link checkpoints-history-title'
										onPressed={() => setExpandedId(expanded ? undefined : checkpoint.id)}
									>
										{checkpoint.title}
									</Button>
									<span className='checkpoints-file-note'>
										{checkpoint.authorIsMe ? Strings.history.you() : checkpoint.authorName}
									</span>
									<span className='checkpoints-file-note'>{fromNow(new Date(checkpoint.time), true)}</span>
									{!checkpoint.shared && <span className='checkpoints-file-status'>{Strings.history.notYetShared()}</span>}
									{expanded && (
										<CheckpointDetails branch={branch} checkpoint={checkpoint} upstream={upstream} onChanged={view.refresh} />
									)}
								</li>
							);
						})}
					</ul>
				)}
			{hasMore && <Button className='checkpoints-link' onPressed={loadMore}>{Strings.history.loadMore()}</Button>}
			{hasUnshared && (
				<Button className='checkpoints-button' onPressed={send}>{Strings.actions.sendChanges()}</Button>
			)}
		</section>
	);
};
