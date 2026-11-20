/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { GitDetails } from './gitDetails.js';
import { showEditDescriptionDialog, showReverseDialog } from './historyDialogs.js';
import { useRunAction } from './useRunAction.js';

/** What an expanded history row needs. */
export interface ICheckpointDetailsProps {
	checkpoint: ICheckpoint;
	branch?: string;
	/** The name of the shared copy of the branch, when the project has one. */
	upstream?: string;
	/** Called after an action ran, so the view loads again. */
	onChanged(): void;
}

/**
 * The expanded row of a checkpoint: its description, the note about partly included files, and
 * the actions that fit it. An unshared checkpoint can be reworded; a shared one can be reversed.
 */
export const CheckpointDetails = ({ checkpoint, branch, upstream, onChanged }: ICheckpointDetailsProps) => {
	const runAction = useRunAction();
	const [gitShown, setGitShown] = useState(false);

	const goBack = async () => {
		await runAction('file-changing', engine => engine.goBackTo(checkpoint.id, []));
		onChanged();
	};

	return (
		<div className='checkpoints-details'>
			{checkpoint.body !== '' && <p className='checkpoints-details-body'>{checkpoint.body}</p>}
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
			{gitShown && <GitDetails branch={branch} commitId={checkpoint.id} upstream={upstream} />}
		</div>
	);
};
