/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { fromNow } from '../../../../../base/common/date.js';
import { OKModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';
import { IEngineState } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { IDialogActions } from './dialogActions.js';

const INTERRUPTED_DIALOG_WIDTH = 560;
const INTERRUPTED_DIALOG_HEIGHT = 480;

/** What the engine reports about an interrupted action. */
export type IInterruptedAction = NonNullable<IEngineState['interrupted']>;

/** The recovery snapshots the engine keeps until the person removes them. */
export type IRecoverySnapshots = IEngineState['recoverySnapshots'];

/**
 * Opens the dialog that explains an interrupted action and offers the two choices of spec 6.3.1.
 * Closing it without a choice changes nothing, and the view offers it again.
 */
export function showInterruptedDialog(interrupted: IInterruptedAction, snapshots: IRecoverySnapshots, actions: IDialogActions): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<InterruptedDialog actions={actions} interrupted={interrupted} renderer={renderer} snapshots={snapshots} />);
}

interface IInterruptedDialogProps {
	actions: IDialogActions;
	interrupted: IInterruptedAction;
	renderer: PositronModalReactRenderer;
	snapshots: IRecoverySnapshots;
}

const InterruptedDialog = ({ actions, interrupted, renderer, snapshots }: IInterruptedDialogProps) => {
	const [remaining, setRemaining] = useState(snapshots);
	const fileCount = interrupted.unexpectedPaths.length;

	const choose = async (choice: 'reverse-keep-newer' | 'leave-as-is') => {
		renderer.dispose();
		// Reversing rewrites files, so unsaved edits are saved first; leaving the project as it is
		// writes nothing.
		await actions.run(choice === 'reverse-keep-newer' ? 'file-changing' : 'no-guard', engine => engine.resolveInterrupted(choice));
	};

	const remove = async (operationId: string) => {
		if (await actions.removeRecoverySnapshot(operationId)) {
			setRemaining(current => current.filter(snapshot => snapshot.operationId !== operationId));
		}
	};

	return (
		<OKModalDialog
			height={INTERRUPTED_DIALOG_HEIGHT}
			okButtonTitle={Strings.interrupted.decideLater()}
			renderer={renderer}
			title={Strings.interrupted.dialogTitle()}
			width={INTERRUPTED_DIALOG_WIDTH}
			onAccept={() => renderer.dispose()}
			onCancel={() => renderer.dispose()}
		>
			<div className='checkpoint-dialog'>
				<p>{fileCount > 0 ? Strings.results.interruptedBy(interrupted.description, fileCount) : Strings.status.interrupted(interrupted.description)}</p>
				{fileCount > 0 && (
					<>
						<p>{Strings.interrupted.changedFiles()}</p>
						<ul aria-label={Strings.interrupted.changedFiles()} className='checkpoint-dialog-files'>
							{interrupted.unexpectedPaths.map(path => <li key={path}>{path}</li>)}
						</ul>
					</>
				)}
				{interrupted.indexUnexpected && <p>{Strings.interrupted.stagedWork()}</p>}
				<div className='checkpoint-dialog-choice'>
					<Button className='checkpoints-button' onPressed={() => choose('reverse-keep-newer')}>
						{Strings.actions.reverseKeepNewer()}
					</Button>
					<p className='checkpoint-dialog-empty'>{Strings.interrupted.reverseHelp()}</p>
				</div>
				<div className='checkpoint-dialog-choice'>
					<Button className='checkpoints-button' onPressed={() => choose('leave-as-is')}>
						{Strings.actions.leaveAsIs()}
					</Button>
					<p className='checkpoint-dialog-empty'>{Strings.interrupted.leaveHelp()}</p>
				</div>
				<RecoverySnapshotList snapshots={remaining} onRemove={remove} />
			</div>
		</OKModalDialog>
	);
};

/**
 * The recovery snapshots, each with its time and a Remove action. Renders nothing for an empty
 * list.
 */
export const RecoverySnapshotList = ({ snapshots, onRemove }: { snapshots: IRecoverySnapshots; onRemove(operationId: string): void }) => {
	if (snapshots.length === 0) {
		return null;
	}
	return (
		<ul className='checkpoints-file-list'>
			{snapshots.map(snapshot => {
				const when = fromNow(new Date(snapshot.time), true);
				return (
					<li key={snapshot.operationId} className='checkpoints-file-row'>
						<span className='checkpoints-file-path'>{Strings.status.recoverySnapshot()}</span>
						<span className='checkpoints-file-note'>{when}</span>
						<Button
							ariaLabel={Strings.actions.removeRecoverySnapshotAt(when)}
							className='checkpoints-link'
							onPressed={() => onRemove(snapshot.operationId)}
						>
							{Strings.actions.removeRecoverySnapshot()}
						</Button>
					</li>
				);
			})}
		</ul>
	);
};
