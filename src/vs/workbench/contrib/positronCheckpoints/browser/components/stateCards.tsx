/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { showCheckResultDialog } from './checkResultDialog.js';
import { showInterruptedDialog, RecoverySnapshotList } from './interruptedDialog.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';
import { useDialogActions } from './useRunAction.js';

/**
 * The cards for decisions that the engine keeps open across a restart: an interrupted action
 * that needs a choice, and a checkpoint a project check changed that needs approval. Each card
 * opens its dialog on a click, and never on its own.
 */
export const StateCards = ({ view }: { view: ICheckpointsViewState }) => {
	const dialogActions = useDialogActions(view.refresh);
	const state = view.state;
	if (!state || state.tracking !== 'tracking' || state.unusual) {
		return null;
	}
	const { interrupted, pendingApproval } = state;

	return (
		<>
			{interrupted && (
				<section aria-label={Strings.interrupted.heading()} className='checkpoints-card'>
					<p>
						{interrupted.unexpectedPaths.length > 0
							? Strings.results.interruptedBy(interrupted.description, interrupted.unexpectedPaths.length)
							: Strings.status.interrupted(interrupted.description)}
					</p>
					<Button className='checkpoints-button checkpoints-button-primary' onPressed={() => showInterruptedDialog(interrupted, state.recoverySnapshots, dialogActions)}>
						{Strings.interrupted.reviewButton()}
					</Button>
				</section>
			)}
			{pendingApproval && (
				<section aria-label={Strings.status.pendingApproval()} className='checkpoints-card'>
					<p>{Strings.status.pendingApproval()}</p>
					<Button
						className='checkpoints-button checkpoints-button-primary'
						onPressed={() => showCheckResultDialog({ kind: 'check-changed-checkpoint', ...pendingApproval }, dialogActions)}
					>
						{Strings.actions.reviewCheckChanges()}
					</Button>
				</section>
			)}
		</>
	);
};

/**
 * The recovery snapshots that remain after an interrupted action, each with a Remove action. A
 * snapshot stays in the list until the person removes it.
 */
export const RecoverySnapshotsSection = ({ view }: { view: ICheckpointsViewState }) => {
	const dialogActions = useDialogActions(view.refresh);
	const snapshots = view.state?.recoverySnapshots ?? [];
	if (snapshots.length === 0) {
		return null;
	}

	return (
		<section aria-label={Strings.status.recoverySnapshot()} className='checkpoints-section'>
			<RecoverySnapshotList snapshots={snapshots} onRemove={operationId => dialogActions.removeRecoverySnapshot(operationId)} />
		</section>
	);
};
