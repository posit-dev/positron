/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpointsEngineProxy, IIncomingPreview } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IIncomingSummary, IncomingRelation, incomingDiffBudget, renderIncomingForModel, summarizeIncomingJob } from '../../common/agent/summarizeIncoming.js';
import { displayTitle } from '../../common/checkpointTitle.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsAgentService } from '../checkpointsAgentService.js';
import { openDiff } from '../openDiff.js';
import { ISyncController } from '../syncController.js';
import { useAgentAvailable } from './useChangesDescription.js';
import { useProposalState } from './proposalCard.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';

/** The text of the incoming changes last rendered for the model, by engine, preview basis, and budget. */
let renderedIncoming: { engine: ICheckpointsEngineProxy; basis: string; budget: number; text: Promise<string> } | undefined;

/**
 * The incoming changes of `preview` as text for the model. The text of the latest preview basis is
 * kept, so the card renders it once even when it mounts again. A failed render is not kept.
 */
function incomingDiffFor(engine: ICheckpointsEngineProxy, preview: IIncomingPreview, budget: number): Promise<string> {
	const kept = renderedIncoming;
	if (kept && kept.engine === engine && kept.basis === preview.basis && kept.budget === budget) {
		return kept.text;
	}
	const text = renderIncomingForModel(engine, preview, budget);
	const entry = { engine, basis: preview.basis, budget, text };
	renderedIncoming = entry;
	text.catch(() => {
		if (renderedIncoming === entry) {
			renderedIncoming = undefined;
		}
	});
	return text;
}

/**
 * The agent's summary of the incoming changes of `preview`, or undefined while there is none:
 * while it loads, when the agent is not available, when the job gave no output, or when there is
 * no incoming checkpoint. It is requested again when the basis of the preview or the person's
 * changed files differ, with the earlier request cancelled.
 */
function useIncomingSummary(preview: IIncomingPreview | undefined, myChangedPaths: string[]): IIncomingSummary | undefined {
	const services = usePositronReactServicesContext();
	const agentService = services.get(ICheckpointsAgentService);
	const available = useAgentAvailable();
	const [summarized, setSummarized] = useState<{ key: string; summary: IIncomingSummary }>();

	// The request reads the latest values; the key says when they are different changes.
	const latest = useRef({ preview, myChangedPaths });
	latest.current = { preview, myChangedPaths };
	const key = preview && preview.incoming.length > 0 ? JSON.stringify([preview.basis, myChangedPaths]) : undefined;

	useEffect(() => {
		const requested = latest.current;
		const engine = services.get(ICheckpointsService).engine;
		if (!available || key === undefined || !requested.preview || !engine) {
			return;
		}
		const { preview, myChangedPaths } = requested;
		const source = new CancellationTokenSource();
		const summarize = async () => {
			const incomingDiff = await incomingDiffFor(engine, preview, incomingDiffBudget(preview, myChangedPaths));
			if (source.token.isCancellationRequested) {
				return;
			}
			const outcome = await agentService.run(summarizeIncomingJob, { preview, incomingDiff, myChangedPaths }, source.token);
			if (outcome.ok && !source.token.isCancellationRequested) {
				setSummarized({ key, summary: outcome.value });
			}
		};
		// A failure leaves the list of incoming checkpoints in place.
		summarize().catch(() => undefined);
		return () => source.dispose(true);
	}, [services, agentService, available, key]);

	return available && summarized && summarized.key === key ? summarized.summary : undefined;
}

/** The sentence that says how the incoming changes relate to the person's work. */
function relationSentence(relation: IncomingRelation, overlaps: number): string {
	switch (relation) {
		case 'unrelated': return Strings.sync.relationUnrelated();
		case 'nearby': return Strings.sync.relationNearby();
		case 'overlapping': return Strings.sync.relationOverlapping(overlaps);
	}
}

/**
 * The sync card at the top of the view, shown while colleagues' checkpoints wait in the shared
 * copy or an overlap is pending. It offers "Get changes" and the detailed differences of each
 * changed file. While the agent has a summary of the incoming changes, the card shows who added
 * them, the summary, and how they relate to the person's work, and the button names the
 * colleague. Without one (while it loads, or when the agent is off or gave no usable answer) it
 * lists the incoming checkpoints with their authors. It is hidden while an accepted proposal
 * waits for Finish. The preview is read when the card appears
 * and again when the number of waiting checkpoints changes.
 */
export const SyncCard = ({ view }: { view: ICheckpointsViewState }) => {
	const services = usePositronReactServicesContext();
	const controller = services.get(ISyncController);
	const [, setVersion] = useState(0);
	const [running, setRunning] = useState(false);
	const [filesShown, setFilesShown] = useState(false);

	const state = view.state;
	const behind = state?.shared.behind ?? 0;
	// After a proposal was accepted, Finish is the way forward, and it gets the changes itself.
	const { state: proposalState } = useProposalState();
	const accepted = proposalState.kind === 'known' && proposalState.info.state === 'accepted';
	const visible = state !== undefined && state.syncAvailable && state.shared.exists && (behind > 0 || state.pendingOverlap) && !accepted;

	useEffect(() => {
		const listener = controller.onDidChange(() => setVersion(version => version + 1));
		return () => listener.dispose();
	}, [controller]);

	useEffect(() => {
		if (visible) {
			controller.refreshPreview();
		}
	}, [controller, visible, behind]);

	const preview = visible ? controller.preview : undefined;
	const summary = useIncomingSummary(preview, view.changes?.files.map(file => file.path) ?? []);

	if (!visible) {
		return null;
	}

	const incoming = preview?.incoming ?? [];
	const colleagues = [...new Set(incoming.filter(checkpoint => !checkpoint.authorIsMe).map(checkpoint => checkpoint.authorName))];
	const author = colleagues.length === 1 ? colleagues[0] : undefined;
	const count = incoming.length > 0 ? incoming.length : behind;

	let heading: string;
	let buttonLabel: string;
	if (author !== undefined) {
		heading = Strings.status.incoming(author, count);
		buttonLabel = Strings.actions.getAuthorsChanges(author);
	} else if (summary && colleagues.length > 1) {
		heading = Strings.sync.fromColleagues(colleagues.length, count);
		buttonLabel = Strings.actions.getColleaguesChanges();
	} else {
		heading = Strings.status.incomingWithoutAuthor(count);
		buttonLabel = Strings.actions.getChanges();
	}

	const getChanges = async () => {
		setRunning(true);
		try {
			await controller.getChanges();
		} finally {
			setRunning(false);
		}
		view.refresh();
	};

	return (
		<section aria-label={Strings.actions.getChanges()} className='checkpoints-card checkpoints-sync-card'>
			{count > 0 && (
				<p className='checkpoints-card-heading'>
					<span aria-hidden='true' className='codicon codicon-cloud-download' />
					{heading}
				</p>
			)}
			{summary && preview && (
				<>
					<p className='checkpoints-description'>{summary.summary}</p>
					<p>{relationSentence(summary.relation, preview.overlaps.length)}</p>
				</>
			)}
			{!summary && preview && count > 0 && (
				<p>{preview.touchesLocalWork ? Strings.status.incomingTouchesWork() : Strings.status.incomingSeparate()}</p>
			)}
			{state.pendingOverlap && <p>{Strings.status.pendingOverlap()}</p>}
			{!summary && incoming.length > 0 && (
				<ul className='checkpoints-history-list'>
					{incoming.map(checkpoint => (
						<li key={checkpoint.id} className='checkpoints-history-row'>
							<span className='checkpoints-history-title'>{displayTitle(checkpoint)}</span>
							<span className='checkpoints-file-note'>{checkpoint.authorIsMe ? Strings.history.you() : checkpoint.authorName}</span>
						</li>
					))}
				</ul>
			)}
			<div className='checkpoints-card-actions'>
				<Button className='checkpoints-button checkpoints-button-primary' disabled={running} onPressed={getChanges}>
					{buttonLabel}
				</Button>
				{preview && preview.changedPaths.length > 0 && (
					<Button ariaExpanded={filesShown} className='checkpoints-link' onPressed={() => setFilesShown(!filesShown)}>
						{Strings.actions.viewDetailedDifferences()}
					</Button>
				)}
			</div>
			{filesShown && preview && (
				<ul aria-label={Strings.sync.changedFiles()} className='checkpoints-file-list'>
					{preview.changedPaths.map(path => (
						<li key={path} className='checkpoints-file-row'>
							<span className='checkpoints-file-path'>{path}</span>
							<Button
								ariaLabel={Strings.actions.viewDetailedDifferencesOf(path)}
								className='checkpoints-link'
								onPressed={() => openDiff(services, { kind: 'incoming', path }, Strings.sync.diffTitle(path))}
							>
								{Strings.actions.viewDetailedDifferences()}
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
};
