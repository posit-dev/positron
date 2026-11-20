/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { openDiff } from '../openDiff.js';
import { ISyncController } from '../syncController.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';

/**
 * The sync card at the top of the view, shown while colleagues' checkpoints wait in the shared
 * copy or an overlap is pending. Without AI it lists the incoming checkpoints with their authors,
 * and offers "Get changes" and the detailed differences of each changed file. The preview is read
 * when the card appears and again when the number of waiting checkpoints changes.
 */
export const SyncCard = ({ view }: { view: ICheckpointsViewState }) => {
	const services = usePositronReactServicesContext();
	const controller = services.get(ISyncController);
	const [, setVersion] = useState(0);
	const [running, setRunning] = useState(false);
	const [filesShown, setFilesShown] = useState(false);

	const state = view.state;
	const behind = state?.shared.behind ?? 0;
	const visible = state !== undefined && state.syncAvailable && state.shared.exists && (behind > 0 || state.pendingOverlap);

	useEffect(() => {
		const listener = controller.onDidChange(() => setVersion(version => version + 1));
		return () => listener.dispose();
	}, [controller]);

	useEffect(() => {
		if (visible) {
			controller.refreshPreview();
		}
	}, [controller, visible, behind]);

	if (!visible) {
		return null;
	}

	const preview = controller.preview;
	const incoming = preview?.incoming ?? [];
	const colleagues = [...new Set(incoming.filter(checkpoint => !checkpoint.authorIsMe).map(checkpoint => checkpoint.authorName))];
	const author = colleagues.length === 1 ? colleagues[0] : undefined;
	const count = incoming.length > 0 ? incoming.length : behind;

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
				<p>{author !== undefined ? Strings.status.incoming(author, count) : Strings.status.incomingWithoutAuthor(count)}</p>
			)}
			{preview && count > 0 && (
				<p>{preview.touchesLocalWork ? Strings.status.incomingTouchesWork() : Strings.status.incomingSeparate()}</p>
			)}
			{state.pendingOverlap && <p>{Strings.status.pendingOverlap()}</p>}
			{incoming.length > 0 && (
				<ul className='checkpoints-history-list'>
					{incoming.map(checkpoint => (
						<li key={checkpoint.id} className='checkpoints-history-row'>
							<span className='checkpoints-history-title'>{checkpoint.title}</span>
							<span className='checkpoints-file-note'>{checkpoint.authorIsMe ? Strings.history.you() : checkpoint.authorName}</span>
						</li>
					))}
				</ul>
			)}
			<div className='checkpoints-card-actions'>
				<Button className='checkpoints-button checkpoints-button-primary' disabled={running} onPressed={getChanges}>
					{author !== undefined ? Strings.actions.getAuthorsChanges(author) : Strings.actions.getChanges()}
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
