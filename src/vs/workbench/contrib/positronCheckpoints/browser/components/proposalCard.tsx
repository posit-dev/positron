/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { IProposalController, ProposalCardState } from '../proposalController.js';
import { showAskForReviewDialog } from './askForReviewDialog.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';

const GITHUB_PROVIDER_ID = 'github';
const GITHUB_SCOPES = ['repo'];

/** The state of `IProposalController`, updated when it changes. */
export function useProposalState(): { state: ProposalCardState; reviewRequired: boolean } {
	const services = usePositronReactServicesContext();
	const controller = services.get(IProposalController);
	const [value, setValue] = useState(() => ({ state: controller.state, reviewRequired: controller.reviewRequired }));

	useEffect(() => {
		setValue({ state: controller.state, reviewRequired: controller.reviewRequired });
		const listener = controller.onDidChange(() => setValue({ state: controller.state, reviewRequired: controller.reviewRequired }));
		return () => listener.dispose();
	}, [controller]);

	return value;
}

/** The buttons a card state offers, in order. */
type CardButton = 'ask' | 'stop' | 'open' | 'finish' | 'sign-in' | 'check-again' | 'dismiss';

/** The sentence and buttons of each card state (proposals spec 6.2), or undefined for a state with no card. */
function describeCard(state: ProposalCardState, reviewRequired: boolean): { sentence: string; buttons: CardButton[] } | undefined {
	switch (state.kind) {
		case 'none':
			return reviewRequired ? { sentence: Strings.proposals.reviewRequired(), buttons: ['ask', 'dismiss'] } : undefined;
		case 'checking':
			return undefined;
		case 'not-sent':
			return { sentence: Strings.proposals.notSent(), buttons: ['ask', 'stop'] };
		case 'not-asked':
			return { sentence: Strings.proposals.notAsked(), buttons: ['ask', 'stop'] };
		case 'unreadable':
			return { sentence: Strings.proposals.unreadable(), buttons: [state.reason === 'sign-in-required' ? 'sign-in' : 'check-again'] };
		case 'not-closed':
			return { sentence: Strings.proposals.notClosed(), buttons: ['open', 'dismiss'] };
		case 'known':
			switch (state.info.state) {
				case 'waiting':
					return { sentence: Strings.proposals.waiting(), buttons: ['open', 'stop'] };
				case 'changes-requested':
					return { sentence: Strings.proposals.changesRequested(), buttons: ['open', 'stop'] };
				case 'approved':
					return { sentence: Strings.proposals.approved(), buttons: ['open'] };
				case 'accepted':
					return { sentence: Strings.proposals.accepted(), buttons: ['finish'] };
				case 'closed':
					return { sentence: Strings.proposals.closed(), buttons: ['stop', 'open'] };
			}
	}
}

/** The label of a card button. */
function buttonLabel(button: CardButton): string {
	switch (button) {
		case 'ask': return Strings.proposals.askForReview();
		case 'stop': return Strings.proposals.stop();
		case 'open': return Strings.proposals.openOnGitHub();
		case 'finish': return Strings.proposals.finish();
		case 'sign-in': return Strings.proposals.signIn();
		case 'check-again': return Strings.proposals.checkAgain();
		case 'dismiss': return Strings.actions.dismiss();
	}
}

/** The first button is the primary one; Dismiss, and Open on GitHub after another button, are links. */
function buttonClass(button: CardButton, index: number): string {
	if (index === 0) {
		return 'checkpoints-button checkpoints-button-primary';
	}
	return button === 'dismiss' || button === 'open' ? 'checkpoints-link' : 'checkpoints-button';
}

/**
 * The proposal card at the top of the view: while a proposal exists, the state of its review and
 * what the person can do next; while a Send was refused because the shared copy on GitHub needs a
 * review, the way to ask for one.
 *
 * @param disabled True while the project is in a state where no action runs.
 */
export const ProposalCard = ({ view, disabled }: { view: ICheckpointsViewState; disabled: boolean }) => {
	const services = usePositronReactServicesContext();
	const controller = services.get(IProposalController);
	const { state, reviewRequired } = useProposalState();
	const [running, setRunning] = useState(false);

	const card = describeCard(state, reviewRequired);
	if (!card) {
		return null;
	}

	/** Runs one action with the buttons disabled, then reads the view again. */
	const runWhileDisabled = async (action: () => Promise<unknown>) => {
		setRunning(true);
		try {
			await action();
		} finally {
			setRunning(false);
		}
		view.refresh();
	};

	const url = state.kind === 'known' ? state.info.url : state.kind === 'not-closed' ? state.url : undefined;

	const press = async (button: CardButton) => {
		switch (button) {
			case 'ask':
				showAskForReviewDialog({ onFinished: view.refresh });
				return;
			case 'stop': {
				const { confirmed } = await services.get(IDialogService).confirm({
					message: Strings.proposals.stopConfirm(),
					primaryButton: Strings.proposals.stop(),
					cancelButton: Strings.actions.cancel(),
				});
				if (confirmed) {
					await runWhileDisabled(() => controller.stop());
				}
				return;
			}
			case 'open':
				if (url) {
					await services.openerService.open(URI.parse(url), { openExternal: true });
				}
				return;
			case 'finish':
				await runWhileDisabled(() => controller.finish());
				return;
			case 'sign-in':
				await runWhileDisabled(async () => {
					try {
						await services.get(IAuthenticationService).createSession(GITHUB_PROVIDER_ID, GITHUB_SCOPES);
					} catch (error) {
						services.get(ILogService).warn('[Checkpoints] The GitHub sign-in was not completed.', error instanceof Error ? error.message : String(error));
						return;
					}
					await controller.refresh();
				});
				return;
			case 'check-again':
				await runWhileDisabled(() => controller.refresh());
				return;
			case 'dismiss':
				controller.dismiss();
				return;
		}
	};

	return (
		<section aria-label={state.kind === 'none' ? Strings.proposals.askForReview() : Strings.proposals.cardLabel()} className='checkpoints-card checkpoints-proposal-card'>
			<p>{card.sentence}</p>
			{state.kind === 'known' && state.info.overlapsShared && <p>{Strings.proposals.overlapsShared()}</p>}
			<div className='checkpoints-card-actions'>
				{card.buttons.map((button, index) => (
					<Button
						key={button}
						className={buttonClass(button, index)}
						disabled={disabled || running}
						onPressed={() => void press(button)}
					>
						{buttonLabel(button)}
					</Button>
				))}
			</div>
		</section>
	);
};
