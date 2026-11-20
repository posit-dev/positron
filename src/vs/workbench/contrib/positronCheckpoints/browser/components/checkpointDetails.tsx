/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IHistoryDescription } from '../../common/agent/describeHistory.js';
import { Strings } from '../../common/checkpointsStrings.js';
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
 * The expanded row of a checkpoint: its description, the note about partly included files, and
 * the actions that fit it. An unshared checkpoint can be reworded; a shared one can be reversed.
 * With a plain-language `description`, its summary takes the place of the original description,
 * and the original message shows in the git details.
 */
export const CheckpointDetails = ({ checkpoint, description, branch, upstream, onChanged }: ICheckpointDetailsProps) => {
	const runAction = useRunAction();
	const [gitShown, setGitShown] = useState(false);

	const goBack = async () => {
		await runAction('file-changing', (engine, { collisionChoices }) => engine.goBackTo(checkpoint.id, collisionChoices));
		onChanged();
	};

	return (
		<div className='checkpoints-details'>
			{description
				? <p className='checkpoints-details-body'>{description.summary}</p>
				: checkpoint.body !== '' && <p className='checkpoints-details-body'>{checkpoint.body}</p>}
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
					originalMessage={description ? [checkpoint.title, checkpoint.body].filter(part => part !== '').join('\n\n') : undefined}
					upstream={upstream}
				/>
			)}
		</div>
	);
};
