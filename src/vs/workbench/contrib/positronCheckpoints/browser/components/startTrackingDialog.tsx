/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { useRunAction } from './useRunAction.js';

const START_DIALOG_WIDTH = 560;
const START_DIALOG_HEIGHT = 560;

/** The detail of the engine's `unavailable` answer when git has no name and email to record. */
const IDENTITY_MISSING_DETAIL = 'identity-missing';

/** What the caller gives the dialog. */
export interface IStartTrackingDialogOptions {
	/** True when the engine already knows that git has no name and email. */
	identityMissing: boolean;
	/** Called after the engine ran, with its result. */
	onFinished?: (result: OperationResult) => void;
}

/** Opens the dialog that starts keeping checkpoints in a plain folder. */
export function showStartTrackingDialog(options: IStartTrackingDialogOptions): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<StartTrackingDialog {...options} renderer={renderer} />);
}

interface IStartTrackingDialogProps extends IStartTrackingDialogOptions {
	renderer: PositronModalReactRenderer;
}

/** True when `email` has text on both sides of an at sign. */
export function isUsableEmail(email: string): boolean {
	const trimmed = email.trim();
	const at = trimmed.indexOf('@');
	return at > 0 && at < trimmed.length - 1;
}

/**
 * Starts keeping checkpoints in a plain folder. The person can edit the proposed list of files to
 * leave out, or untick it to leave nothing out. The name and email fields appear when git has
 * none, either because the engine said so up front or because starting reported it.
 */
export const StartTrackingDialog = (props: IStartTrackingDialogProps) => {
	const services = usePositronReactServicesContext();
	const runAction = useRunAction();
	const [identityNeeded, setIdentityNeeded] = useState(props.identityMissing);
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [leaveOut, setLeaveOut] = useState(true);
	const [patterns, setPatterns] = useState('');
	const [running, setRunning] = useState(false);

	useEffect(() => {
		let current = true;
		const engine = services.get(ICheckpointsService).engine;
		engine?.proposedGitignore().then(
			proposed => {
				if (current) {
					setPatterns(proposed);
				}
			},
			error => services.get(ILogService).error('The proposed list of files to leave out could not be read.', error)
		);
		return () => { current = false; };
	}, [services]);

	const emailProblem = identityNeeded && email.trim() !== '' && !isUsableEmail(email);
	const ready = !identityNeeded || (name.trim() !== '' && isUsableEmail(email));

	const submit = async () => {
		if (!ready || running) {
			return;
		}
		setRunning(true);
		const identity = identityNeeded ? { name: name.trim(), email: email.trim() } : undefined;
		const gitignore = leaveOut && patterns.trim() !== '' ? patterns : undefined;
		const result = await runAction('no-guard', async engine => {
			const started = await engine.startTracking(identity, gitignore);
			if (started.kind === 'unavailable' && started.detail === IDENTITY_MISSING_DETAIL) {
				// The fields appear and nothing else is said: the dialog is the answer.
				setIdentityNeeded(true);
				return undefined;
			}
			return started;
		});
		if (result === undefined) {
			setRunning(false);
			return;
		}
		props.renderer.dispose();
		props.onFinished?.(result);
	};

	return (
		<OKCancelModalDialog
			cancelButtonTitle={Strings.actions.cancel()}
			height={START_DIALOG_HEIGHT}
			okButtonTitle={Strings.start.startButton()}
			okDisabled={!ready || running}
			renderer={props.renderer}
			title={Strings.start.dialogTitle()}
			width={START_DIALOG_WIDTH}
			onAccept={submit}
			onCancel={() => props.renderer.dispose()}
		>
			<div className='checkpoint-dialog'>
				<p>{Strings.start.intro()}</p>
				{identityNeeded && (
					<fieldset className='checkpoint-dialog-chunk'>
						<p>{Strings.start.identityWhy()}</p>
						<LabeledTextInput
							autoFocus
							label={Strings.start.nameLabel()}
							value={name}
							onChange={e => setName(e.target.value)}
						/>
						<LabeledTextInput
							errorMsg={emailProblem ? Strings.start.emailInvalid() : undefined}
							label={Strings.start.emailLabel()}
							value={email}
							onChange={e => setEmail(e.target.value)}
						/>
					</fieldset>
				)}
				<label>
					<input checked={leaveOut} type='checkbox' onChange={e => setLeaveOut(e.target.checked)} />
					<span>{Strings.start.leaveOut()}</span>
				</label>
				<label className='checkpoint-dialog-body checkpoint-dialog-patterns'>
					<span>{Strings.start.leaveOutBox()}</span>
					<textarea
						disabled={!leaveOut}
						rows={8}
						value={patterns}
						onChange={e => setPatterns(e.target.value)}
					/>
				</label>
				<p className='checkpoint-dialog-empty'>{Strings.start.leaveOutHelp()}</p>
			</div>
		</OKCancelModalDialog>
	);
};
