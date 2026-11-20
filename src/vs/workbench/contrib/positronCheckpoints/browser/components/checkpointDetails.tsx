/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint, IChangedFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IHistoryDescription } from '../../common/agent/describeHistory.js';
import { displayTitle } from '../../common/checkpointTitle.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsMessageService, reportReadFailure } from '../checkpointsMessages.js';
import { openDiff } from '../openDiff.js';
import { FileRow } from './fileRow.js';
import { knownSizes } from './fileStatus.js';
import { GitDetails } from './gitDetails.js';
import { showEditDescriptionDialog, showReverseDialog } from './historyDialogs.js';
import { useRunAction } from './useRunAction.js';

/** What an expanded history row needs. */
export interface ICheckpointDetailsProps {
	checkpoint: ICheckpoint;
	/** A plain-language description of a colleague's checkpoint, shown in place of its message. */
	description?: IHistoryDescription;
	branch?: string;
	/** The name of the shared copy of the branch, when the project has one. */
	upstream?: string;
	/** Called after an action ran, so the view loads again. */
	onChanged(): void;
}

/**
 * The files the checkpoint `id` changed, read from the engine once per id. Undefined while they
 * load, and when they could not be read (the could-not-load sentence then shows on the status
 * line of the view).
 */
function useCheckpointFiles(id: string): IChangedFile[] | undefined {
	const services = usePositronReactServicesContext();
	const [loaded, setLoaded] = useState<{ id: string; files: IChangedFile[] }>();

	useEffect(() => {
		const engine = services.get(ICheckpointsService).engine;
		if (!engine) {
			return;
		}
		let current = true;
		engine.getCheckpointFiles(id).then(
			files => {
				if (current) {
					setLoaded({ id, files });
				}
			},
			error => {
				if (current) {
					reportReadFailure(services.get(ILogService), services.get(ICheckpointsMessageService), 'The files of a checkpoint could not be read.', error);
				}
			}
		);
		return () => { current = false; };
	}, [services, id]);

	return loaded?.id === id ? loaded.files : undefined;
}

/**
 * The expanded row of a checkpoint: its description, the files it changed with a plain status
 * word and the detailed differences of each, the note about partly included files, and the
 * actions that fit it. An unshared checkpoint can be reworded; a shared one can be reversed.
 * With a plain-language `description`, its summary takes the place of the original description,
 * and the original message shows in the git details. The original message also shows there when
 * the row shows a neutral title in place of one with a git word (`displayTitle`).
 */
export const CheckpointDetails = ({ checkpoint, description, branch, upstream, onChanged }: ICheckpointDetailsProps) => {
	const services = usePositronReactServicesContext();
	const runAction = useRunAction();
	const [gitShown, setGitShown] = useState(false);
	const files = useCheckpointFiles(checkpoint.id);
	const title = description?.title ?? displayTitle(checkpoint);

	const goBack = async () => {
		await runAction('file-changing', (engine, { collisionChoices }) => engine.goBackTo(checkpoint.id, collisionChoices));
		onChanged();
	};

	return (
		<div className='checkpoints-details'>
			{description
				? <p className='checkpoints-details-body'>{description.summary}</p>
				: checkpoint.body !== '' && <p className='checkpoints-details-body'>{checkpoint.body}</p>}
			{files !== undefined && (files.length === 0
				? <p className='checkpoints-note'>{Strings.history.noFiles()}</p>
				: (
					<ul aria-label={Strings.history.files()} className='checkpoints-file-list'>
						{files.map(file => (
							<FileRow
								key={file.path}
								file={file}
								onViewDifferences={() => openDiff(services, { kind: 'checkpoint', id: checkpoint.id, path: file.path }, Strings.diff.checkpointTitle(file.path, title), knownSizes(file))}
							/>
						))}
					</ul>
				))}
			{checkpoint.partialFiles.length > 0 && (
				<p className='checkpoints-note'>{Strings.history.partialFiles(checkpoint.partialFiles)}</p>
			)}
			<div className='checkpoints-details-actions'>
				<Button className='checkpoints-link' onPressed={goBack}>{Strings.actions.goBack()}</Button>
				{checkpoint.shared
					? <Button className='checkpoints-link' onPressed={() => showReverseDialog({ checkpoint, onFinished: onChanged })}>{Strings.actions.reverseCheckpoint()}</Button>
					: <Button className='checkpoints-link' onPressed={() => showEditDescriptionDialog({ checkpoint, onFinished: onChanged })}>{Strings.actions.editDescription()}</Button>}
				<Button className='checkpoints-link' onPressed={() => setGitShown(!gitShown)}>{Strings.actions.showGitDetails()}</Button>
			</div>
			{gitShown && (
				<GitDetails
					branch={branch}
					commitId={checkpoint.id}
					originalMessage={description || displayTitle(checkpoint) !== checkpoint.title ? [checkpoint.title, checkpoint.body].filter(part => part !== '').join('\n\n') : undefined}
					upstream={upstream}
				/>
			)}
		</div>
	);
};
