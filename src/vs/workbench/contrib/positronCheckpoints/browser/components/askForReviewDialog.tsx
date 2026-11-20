/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { describeProposalJob } from '../../common/agent/describeProposal.js';
import { displayTitle } from '../../common/checkpointTitle.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsAgentService } from '../checkpointsAgentService.js';
import { AskStep, IProposalController } from '../proposalController.js';
import { DisclosureCard } from './disclosureCard.js';
import { useAgentAvailable } from './useChangesDescription.js';
import { HISTORY_PAGE_SIZE } from './useCheckpointsState.js';

const ASK_DIALOG_WIDTH = 560;
const ASK_DIALOG_HEIGHT = 480;

/** What the caller gives the dialog. */
export interface IAskForReviewDialogOptions {
	/** Called after the review was asked for. */
	onFinished?: () => void;
}

/** Opens the dialog that asks a colleague to review the person's checkpoints. */
export function showAskForReviewDialog(options: IAskForReviewDialogOptions = {}): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<AskForReviewDialog {...options} renderer={renderer} />);
}

interface IAskForReviewDialogProps extends IAskForReviewDialogOptions {
	renderer: PositronModalReactRenderer;
}

/** Where the dialog is: reading the checkpoints, asking, running the steps, or stopped at a failed step. */
type Phase = 'loading' | 'form' | 'running' | 'failed';

/** The unshared checkpoints of the first page of history, oldest first. */
function unsharedCheckpoints(history: ICheckpoint[]): ICheckpoint[] {
	return history.filter(checkpoint => !checkpoint.shared).reverse();
}

/** The message before the agent writes one: each checkpoint's title, with its description below it. */
function listMessage(checkpoints: ICheckpoint[]): string {
	return checkpoints.map(checkpoint => {
		const body = checkpoint.body.trim();
		const lines = [`- ${displayTitle(checkpoint)}`];
		if (body !== '') {
			lines.push(...body.split('\n').map(line => `  ${line}`));
		}
		return lines.join('\n');
	}).join('\n');
}

/** The sentence that names the step that runs. */
function stepSentence(step: AskStep): string {
	switch (step) {
		case 'starting': return Strings.proposals.starting();
		case 'sending': return Strings.proposals.sending();
		case 'asking': return Strings.proposals.asking();
	}
}

/**
 * Asks for a review: a title and a message for the colleague, then, after one click, the steps
 * the proposal controller has not done yet. Opened again for the same proposal, the dialog shows
 * the fields of the last attempt. Otherwise the title is the title of the one unshared checkpoint,
 * or of the oldest, and the message starts as the list of those checkpoints; while the agent is
 * available, its description replaces the message unless the person edited it. For a sent
 * proposal with no earlier attempt, the fields start from the newest checkpoint. A failed step says what was
 * done, and Try Again runs the steps that are left.
 */
export const AskForReviewDialog = (props: IAskForReviewDialogProps) => {
	const services = usePositronReactServicesContext();
	const agentAvailable = useAgentAvailable();
	const [phase, setPhase] = useState<Phase>('loading');
	/** The checkpoints the agent describes; empty when the fields come from elsewhere. */
	const [checkpoints, setCheckpoints] = useState<ICheckpoint[]>([]);
	/** The number of checkpoints that go for review, or undefined when it is not known. */
	const [count, setCount] = useState<number>();
	const [title, setTitle] = useState('');
	const [message, setMessage] = useState('');
	const messageEdited = useRef(false);
	const [step, setStep] = useState<AskStep>();
	const [failure, setFailure] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			const engine = services.get(ICheckpointsService).engine;
			let history: ICheckpoint[] = [];
			try {
				history = engine ? await engine.getHistory(0, HISTORY_PAGE_SIZE) : [];
			} catch (error) {
				services.get(ILogService).error('[Checkpoints] The checkpoints for the review could not be read.', error);
			}
			if (cancelled) {
				return;
			}
			const last = services.get(IProposalController).lastAsk();
			const unshared = unsharedCheckpoints(history);
			if (last) {
				// The fields of the last attempt for this proposal; the person wrote or accepted them.
				messageEdited.current = true;
				setTitle(last.title);
				setMessage(last.body);
				setCount(last.count);
			} else if (unshared.length > 0) {
				setCheckpoints(unshared);
				setCount(unshared.length);
				setTitle(displayTitle(unshared[0]));
				setMessage(listMessage(unshared));
			} else if (history.length > 0) {
				// A sent proposal: its checkpoints count as shared, and their number is not known.
				setTitle(displayTitle(history[0]));
				setMessage(listMessage(history.slice(0, 1)));
			}
			setPhase('form');
		};
		void load();
		return () => { cancelled = true; };
	}, [services]);

	// The agent's description replaces the message while the person has not edited it.
	useEffect(() => {
		const engine = services.get(ICheckpointsService).engine;
		if (!agentAvailable || checkpoints.length === 0 || !engine) {
			return;
		}
		const source = new CancellationTokenSource();
		const describe = async () => {
			const paths = new Set<string>();
			for (const checkpoint of checkpoints) {
				const files = await engine.getCheckpointFiles(checkpoint.id).catch(() => []);
				files.forEach(file => paths.add(file.path));
			}
			if (source.token.isCancellationRequested) {
				return;
			}
			const input = {
				checkpoints: checkpoints.map(checkpoint => ({ id: checkpoint.id, title: checkpoint.title, body: checkpoint.body })),
				changedPaths: [...paths].sort(),
			};
			const outcome = await services.get(ICheckpointsAgentService).run(describeProposalJob, input, source.token);
			if (outcome.ok && !source.token.isCancellationRequested && !messageEdited.current) {
				setMessage(outcome.value.body);
			}
		};
		// A failure leaves the list of checkpoints in place.
		describe().catch(error => services.get(ILogService).error('[Checkpoints] The proposal could not be described.', error));
		return () => source.dispose(true);
	}, [services, agentAvailable, checkpoints]);

	const run = async () => {
		setPhase('running');
		setFailure(undefined);
		const result = await services.get(IProposalController).ask(title.trim(), message.trim(), setStep, count);
		if (result.ok) {
			props.renderer.dispose();
			props.onFinished?.();
			return;
		}
		setFailure(result.message);
		setPhase('failed');
	};

	const accept = async () => {
		if (phase === 'form' || phase === 'failed') {
			await run();
		}
	};

	const cancel = () => {
		// A running step cannot be taken back, so the dialog stays until the step ends.
		if (phase !== 'running') {
			props.renderer.dispose();
		}
	};

	const editable = phase === 'form';
	return (
		<OKCancelModalDialog
			cancelButtonTitle={phase === 'failed' ? Strings.actions.close() : Strings.actions.cancel()}
			height={ASK_DIALOG_HEIGHT}
			okButtonTitle={phase === 'failed' ? Strings.share.tryAgain() : Strings.proposals.askForReview()}
			okDisabled={phase === 'loading' || phase === 'running' || title.trim() === ''}
			renderer={props.renderer}
			title={Strings.proposals.dialogTitle()}
			width={ASK_DIALOG_WIDTH}
			onAccept={accept}
			onCancel={cancel}
		>
			<div className='checkpoint-dialog'>
				<DisclosureCard />
				<LabeledTextInput
					autoFocus
					disabled={!editable}
					label={Strings.proposals.titleLabel()}
					value={title}
					onChange={e => setTitle(e.target.value)}
				/>
				<label className='checkpoint-dialog-body'>
					<span>{Strings.proposals.messageLabel()}</span>
					<textarea
						disabled={!editable}
						rows={6}
						value={message}
						onChange={e => {
							messageEdited.current = true;
							setMessage(e.target.value);
						}}
					/>
				</label>
				{phase !== 'loading' && <p>{count !== undefined ? Strings.proposals.goesForReview(count) : Strings.proposals.goesForReviewNoCount()}</p>}
				{phase === 'running' && step && <p aria-live='polite' role='status'>{stepSentence(step)}</p>}
				{phase === 'failed' && failure && <p className='checkpoint-dialog-warning' role='alert'>{failure}</p>}
			</div>
		</OKCancelModalDialog>
	);
};
