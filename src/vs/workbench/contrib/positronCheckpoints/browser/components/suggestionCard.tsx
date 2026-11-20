/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { IChangeSet } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IProposedChunk } from '../../common/agent/splitIntoChunks.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsSuggestionService, ISuggestion } from '../checkpointsSuggestionService.js';
import { showCheckpointDialog } from './checkpointDialog.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';

/** The number of files a proposed checkpoint touches. */
function fileCount(changes: IChangeSet, chunk: IProposedChunk): number {
	const hunkIds = new Set(chunk.hunkIds);
	const paths = new Set(chunk.wholeFiles);
	for (const file of changes.files) {
		if (file.hunks.some(hunk => hunkIds.has(hunk.id))) {
			paths.add(file.path);
		}
	}
	return paths.size;
}

/** The open suggestion of `ICheckpointsSuggestionService`, updated when it changes. */
function useSuggestion(): ISuggestion | undefined {
	const services = usePositronReactServicesContext();
	const suggestionService = services.get(ICheckpointsSuggestionService);
	const [suggestion, setSuggestion] = useState(suggestionService.current);

	useEffect(() => {
		setSuggestion(suggestionService.current);
		const listener = suggestionService.onDidChange(() => setSuggestion(suggestionService.current));
		return () => listener.dispose();
	}, [suggestionService]);

	return suggestion;
}

/**
 * The checkpoint suggestion card (spec 7.1 and 9), shown while a suggestion is open. It lists the
 * proposed checkpoints with a tick each, ticked when the work in it looks finished. "Create N
 * checkpoints" and "Edit" both open the checkpoint dialog with the proposed checkpoints and their
 * ticks, and create nothing by themselves. "Dismiss" closes the suggestion.
 */
export const SuggestionCard = ({ view }: { view: ICheckpointsViewState }) => {
	const services = usePositronReactServicesContext();
	const suggestionService = services.get(ICheckpointsSuggestionService);
	const suggestion = useSuggestion();
	// The ticks of the shown suggestion; a new suggestion starts from its own.
	const [ticks, setTicks] = useState<{ suggestion: ISuggestion; ticked: boolean[] }>();

	if (!suggestion) {
		return null;
	}

	const ticked = ticks?.suggestion === suggestion ? ticks.ticked : suggestion.chunks.map(chunk => chunk.finished);
	const tickedCount = ticked.filter(Boolean).length;
	const setTicked = (index: number, value: boolean) => {
		setTicks({ suggestion, ticked: ticked.map((old, i) => i === index ? value : old) });
	};

	const openDialog = () => showCheckpointDialog({
		changes: suggestion.changes,
		initialChunks: suggestion.chunks.map((chunk, index) => ({
			title: chunk.title,
			body: chunk.summary,
			hunkIds: chunk.hunkIds,
			wholeFiles: chunk.wholeFiles,
			ticked: ticked[index],
		})),
		onFinished: result => {
			if (result?.kind === 'done') {
				suggestionService.clear();
			}
			view.refresh();
		},
	});

	return (
		<section aria-label={Strings.suggestions.heading()} className='checkpoints-card checkpoints-suggestion-card'>
			<p>{Strings.suggestions.goodPlace()}</p>
			<ol className='checkpoints-file-list'>
				{suggestion.chunks.map((chunk, index) => (
					<li key={index} className='checkpoints-file-row'>
						<label className='checkpoints-file-path'>
							<input checked={ticked[index]} type='checkbox' onChange={e => setTicked(index, e.target.checked)} />
							<span>{chunk.title}</span>
						</label>
						<span className='checkpoints-file-note'>{Strings.changes.fileCount(fileCount(suggestion.changes, chunk))}</span>
					</li>
				))}
			</ol>
			<div className='checkpoints-card-actions'>
				<Button className='checkpoints-button checkpoints-button-primary' disabled={tickedCount === 0} onPressed={openDialog}>
					{Strings.actions.createCheckpoints(tickedCount)}
				</Button>
				<Button className='checkpoints-link' onPressed={openDialog}>
					{Strings.actions.edit()}
				</Button>
				<Button className='checkpoints-link' onPressed={() => suggestionService.dismiss()}>
					{Strings.actions.dismiss()}
				</Button>
			</div>
		</section>
	);
};
