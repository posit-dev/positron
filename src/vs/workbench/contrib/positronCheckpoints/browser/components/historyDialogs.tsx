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
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { CHECKPOINT_TITLE_LIMIT } from '../../common/checkpointsLimits.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { titleProblem } from './chunkDraft.js';
import { useRunAction } from './useRunAction.js';

const HISTORY_DIALOG_WIDTH = 480;
const EDIT_DIALOG_HEIGHT = 340;
const REVERSE_DIALOG_HEIGHT = 200;

/** What the caller gives a history dialog. */
export interface IHistoryDialogOptions {
	checkpoint: ICheckpoint;
	/** Called after the action ran. */
	onFinished?: () => void;
}

/** Opens the dialog that edits the title and description of an unshared checkpoint. */
export function showEditDescriptionDialog(options: IHistoryDialogOptions): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<EditDescriptionDialog {...options} renderer={renderer} />);
}

/** Opens the dialog that asks before a shared checkpoint is reversed. */
export function showReverseDialog(options: IHistoryDialogOptions): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<ReverseDialog {...options} renderer={renderer} />);
}

interface IDialogProps extends IHistoryDialogOptions {
	renderer: PositronModalReactRenderer;
}

const EditDescriptionDialog = ({ checkpoint, renderer, onFinished }: IDialogProps) => {
	const runAction = useRunAction();
	const [title, setTitle] = useState(checkpoint.title);
	const [body, setBody] = useState(checkpoint.body);
	const problem = titleProblem(title);

	const submit = async () => {
		renderer.dispose();
		await runAction('no-guard', engine => engine.editDescription(checkpoint.id, title.trim(), body.trim()));
		onFinished?.();
	};

	return (
		<OKCancelModalDialog
			cancelButtonTitle={Strings.actions.cancel()}
			height={EDIT_DIALOG_HEIGHT}
			okButtonTitle={Strings.history.editSave()}
			okDisabled={problem !== undefined}
			renderer={renderer}
			title={Strings.history.editDialogTitle()}
			width={HISTORY_DIALOG_WIDTH}
			onAccept={submit}
			onCancel={() => renderer.dispose()}
		>
			<div className='checkpoint-dialog'>
				<LabeledTextInput
					errorMsg={problem === 'too-long' ? Strings.changes.titleTooLong(CHECKPOINT_TITLE_LIMIT) : undefined}
					label={Strings.changes.titleLabel()}
					value={title}
					onChange={e => setTitle(e.target.value)}
				/>
				<label className='checkpoint-dialog-body'>
					<span>{Strings.changes.bodyLabel()}</span>
					<textarea rows={4} value={body} onChange={e => setBody(e.target.value)} />
				</label>
			</div>
		</OKCancelModalDialog>
	);
};

const ReverseDialog = ({ checkpoint, renderer, onFinished }: IDialogProps) => {
	const runAction = useRunAction();

	const submit = async () => {
		renderer.dispose();
		await runAction('checkpoint', engine => engine.reverseCheckpoint(checkpoint.id));
		onFinished?.();
	};

	return (
		<OKCancelModalDialog
			cancelButtonTitle={Strings.actions.cancel()}
			height={REVERSE_DIALOG_HEIGHT}
			okButtonTitle={Strings.history.reverseConfirm()}
			renderer={renderer}
			title={Strings.history.reverseDialogTitle()}
			width={HISTORY_DIALOG_WIDTH}
			onAccept={submit}
			onCancel={() => renderer.dispose()}
		>
			<p>{Strings.history.reverseExplain(checkpoint.title)}</p>
		</OKCancelModalDialog>
	);
};
