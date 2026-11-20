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
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
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

/** Where the proposed list of files to leave out is: being read, read, or not readable. */
type ProposalState = 'loading' | 'loaded' | 'failed';

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
 * leave out, or untick it to leave nothing out. Start waits for the proposed list while it is
 * ticked; when the list cannot be read, the dialog says so and offers to read it again. The name
 * and email fields appear when git has none, either because the engine said so up front or
 * because starting reported it. Start asks about unsaved editors first, because the first
 * checkpoint reads every file.
 */
export const StartTrackingDialog = (props: IStartTrackingDialogProps) => {
	const services = usePositronReactServicesContext();
	const runAction = useRunAction();
	const [identityNeeded, setIdentityNeeded] = useState(props.identityMissing);
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [leaveOut, setLeaveOut] = useState(true);
	const [patterns, setPatterns] = useState('');
	const [proposal, setProposal] = useState<ProposalState>('loading');
	// Incremented by Try Again, which reads the proposed list again.
	const [proposalAttempt, setProposalAttempt] = useState(0);
	const [identityNotRecorded, setIdentityNotRecorded] = useState(false);
	const [running, setRunning] = useState(false);

	useEffect(() => {
		let current = true;
		setProposal('loading');
		const engine = services.get(ICheckpointsService).engine;
		if (!engine) {
			setProposal('failed');
			return;
		}
		engine.proposedGitignore().then(
			proposed => {
				if (current) {
					setPatterns(proposed);
					setProposal('loaded');
				}
			},
			error => {
				services.get(ILogService).error('The proposed list of files to leave out could not be read.', error);
				if (current) {
					setProposal('failed');
				}
			}
		);
		return () => { current = false; };
	}, [services, proposalAttempt]);

	const emailProblem = identityNeeded && email.trim() !== '' && !isUsableEmail(email);
	const identityReady = !identityNeeded || (name.trim() !== '' && isUsableEmail(email));
	// With the list unticked, nothing is left out and the proposal is not needed.
	const ready = identityReady && (proposal === 'loaded' || !leaveOut);

	const submit = async () => {
		if (!ready || running) {
			return;
		}
		setRunning(true);
		setIdentityNotRecorded(false);
		const identity = identityNeeded ? { name: name.trim(), email: email.trim() } : undefined;
		const gitignore = leaveOut && patterns.trim() !== '' ? patterns : undefined;
		let result: OperationResult | undefined;
		try {
			result = await runAction('checkpoint', async engine => {
				const started = await engine.startTracking(identity, gitignore);
				if (started.kind === 'unavailable' && started.detail === IDENTITY_MISSING_DETAIL) {
					if (identity) {
						// The fields were filled and the engine still has no name and email.
						setIdentityNotRecorded(true);
					} else {
						// The fields appear and nothing else is said: the dialog is the answer.
						setIdentityNeeded(true);
					}
					return undefined;
				}
				return started;
			});
		} finally {
			setRunning(false);
		}
		if (result === undefined) {
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
						{identityNotRecorded && <p className='checkpoint-dialog-warning' role='alert'>{Strings.start.identityNotRecorded()}</p>}
					</fieldset>
				)}
				<label>
					<input checked={leaveOut} type='checkbox' onChange={e => setLeaveOut(e.target.checked)} />
					<span>{Strings.start.leaveOut()}</span>
				</label>
				<label className='checkpoint-dialog-body checkpoint-dialog-patterns'>
					<span>{Strings.start.leaveOutBox()}</span>
					<textarea
						disabled={!leaveOut || proposal !== 'loaded'}
						rows={8}
						value={patterns}
						onChange={e => setPatterns(e.target.value)}
					/>
				</label>
				{proposal === 'failed' && (
					<div className='checkpoint-dialog-warning' role='alert'>
						<p>{Strings.start.couldNotLoad()}</p>
						<Button className='checkpoints-link' onPressed={() => setProposalAttempt(attempt => attempt + 1)}>
							{Strings.start.tryAgain()}
						</Button>
					</div>
				)}
				<p className='checkpoint-dialog-empty'>{Strings.start.leaveOutHelp()}</p>
			</div>
		</OKCancelModalDialog>
	);
};
