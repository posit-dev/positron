/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { IEngineState, OperationResult } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../common/checkpointsStrings.js';
import { ICheckpointsMessageService } from './checkpointsMessages.js';
import { FindProposalResult, IGitHubClient, ProjectLink, ProposalInfo, ProposalState } from './github/githubClient.js';
import { RunActionCall, runAction } from './runAction.js';
import { ISyncController } from './syncController.js';

/** True while the project can ask for a review: its shared copy is on GitHub and it has unshared checkpoints. */
export const CHECKPOINTS_CAN_ASK_FOR_REVIEW = new RawContextKey<boolean>('positronCheckpoints.canAskForReview', false);

/**
 * What the proposal card shows. `checking` is the time before the first answer from GitHub about
 * a sent proposal. `not-closed` follows a stop whose close on GitHub failed; it lasts until it is
 * dismissed or a new proposal exists.
 */
export type ProposalCardState =
	| { kind: 'none' }
	| { kind: 'not-sent' }
	| { kind: 'checking' }
	| { kind: 'not-asked' }
	| { kind: 'known'; info: ProposalInfo }
	| { kind: 'unreadable'; reason: 'sign-in-required' | 'other' }
	| { kind: 'not-closed'; url: string };

/** A step of asking for a review, in the order the steps run. */
export type AskStep = 'starting' | 'sending' | 'asking';

/** The outcome of `ask`. A failure names the step that failed and says what was done. */
export type AskResult = { ok: true } | { ok: false; failedStep: AskStep; message: string };

/** The title, message, and number of checkpoints of the last attempt to ask for a review. The number is undefined when it was not known. */
export interface IAskDraft {
	title: string;
	body: string;
	count: number | undefined;
}

/** How long state change events are gathered before they start one read. */
const STATE_CHANGE_DELAY_MS = 300;

/** The states of a proposal that is open on GitHub. */
const OPEN_STATES: ReadonlySet<ProposalState> = new Set(['waiting', 'changes-requested', 'approved']);

export const IProposalController = createDecorator<IProposalController>('positronCheckpointsProposalController');

/**
 * Proposals for the view of one window: the state of the current proposal on this computer and on
 * GitHub, and the actions that start, send, finish, and stop it. React components only render it.
 */
export interface IProposalController {
	readonly _serviceBrand: undefined;

	/** What the proposal card shows. */
	readonly state: ProposalCardState;

	/** True while a Send was refused because the shared copy on GitHub needs a review, until the person asks or dismisses it. */
	readonly reviewRequired: boolean;

	/** Fires when `state` or `reviewRequired` changes. */
	readonly onDidChange: Event<void>;

	/** True when the shared copy is on GitHub, the project has unshared checkpoints, and no proposal exists. */
	canAsk(): boolean;

	/**
	 * Runs the steps of asking for a review that are not done yet, in order: start the proposal,
	 * send it, and open it on GitHub. A pull request that is already open counts as asked.
	 */
	ask(title: string, body: string, onStep: (step: AskStep) => void, count?: number): Promise<AskResult>;

	/** The last attempt to ask for a review of the current proposal (or, with no proposal, of the unshared checkpoints), kept in memory. */
	lastAsk(): IAskDraft | undefined;

	/** Reads the state of the proposal again, and asks GitHub about it when it was sent. */
	refresh(): Promise<void>;

	/** Sends the unshared checkpoints, and notes a refusal that needs a review. */
	send(): Promise<OperationResult | undefined>;

	/** Checks the shared copy, returns from the accepted proposal, and then gets the changes of the shared copy. */
	finish(): Promise<OperationResult | undefined>;

	/**
	 * Returns the proposal's checkpoints to the main line, then closes the proposal on GitHub when it
	 * is open there. A refusal until changes are got has the detail `get-changes-before-stop`.
	 */
	stop(): Promise<{ engine: OperationResult | undefined; closedOnGitHub: boolean }>;

	/** Hides the review-required card or the notice of a failed close. */
	dismiss(): void;
}

/** The GitHub project of the shared copy, or undefined when it is not on GitHub. */
function gitHubProject(github: IGitHubClient, state: IEngineState | undefined): ProjectLink | undefined {
	return state?.sharedUrl ? github.parseProjectLink(state.sharedUrl) : undefined;
}

/** The branch name of a shared-copy branch as git names it locally (`origin/main` gives `main`), or undefined. */
function hostBranchName(name: string | undefined): string | undefined {
	const slash = name?.indexOf('/') ?? -1;
	return name !== undefined && slash > 0 && slash < name.length - 1 ? name.slice(slash + 1) : undefined;
}

export class ProposalController extends Disposable implements IProposalController {
	declare readonly _serviceBrand: undefined;

	private _engineState: IEngineState | undefined;
	/** The last answer of GitHub, for the proposal branch it was asked about. */
	private _found: { branch: string; result: FindProposalResult } | undefined;
	private _reviewRequired = false;
	private _notClosedUrl: string | undefined;

	/** Counts state reads and GitHub lookups, so that the answer of a superseded one is dropped. */
	private _stateRequest = 0;
	private _findRequest = 0;
	/** The branch a GitHub lookup runs for, so that one runs at a time for it. */
	private _finding: string | undefined;

	/**
	 * The current proposal as this window saw it. `seenUnsent` is true when this window saw it before
	 * its first send, so that any pull request for it was opened after that. `reviewSeen` is true once
	 * this window opened its pull request or GitHub reported an open one. `hostBase` is the base
	 * branch as the shared copy names it. All of it is forgotten when the proposal goes away.
	 */
	private _seen: { branch: string; seenUnsent: boolean; reviewSeen: boolean; hostBase?: string } | undefined;
	/** The base branch as the shared copy names it, read while no proposal exists. */
	private _pendingHostBase: string | undefined;
	/** The last attempt to ask, with the proposal it was for (undefined before the proposal started). */
	private _lastAsk: (IAskDraft & { branch: string | undefined }) | undefined;

	private readonly _canAskKey: IContextKey<boolean>;
	private readonly _stateReader = this._register(new RunOnceScheduler(() => void this._readState(), STATE_CHANGE_DELAY_MS));

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@ICheckpointsService private readonly _checkpointsService: ICheckpointsService,
		@IGitHubClient private readonly _github: IGitHubClient,
		@ISyncController private readonly _syncController: ISyncController,
		@ICheckpointsMessageService private readonly _messageService: ICheckpointsMessageService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._canAskKey = CHECKPOINTS_CAN_ASK_FOR_REVIEW.bindTo(contextKeyService);
		this._register(this._checkpointsService.onDidChangeEngine(() => void this._readState()));
		this._register(this._checkpointsService.onDidChangeState(() => this._stateReader.schedule()));
		void this._readState();
	}

	get state(): ProposalCardState {
		const proposal = this._engineState?.proposal;
		if (!proposal) {
			return this._notClosedUrl !== undefined ? { kind: 'not-closed', url: this._notClosedUrl } : { kind: 'none' };
		}
		if (!proposal.sent) {
			return { kind: 'not-sent' };
		}
		const found = this._found?.branch === proposal.branch ? this._found.result : undefined;
		if (!found) {
			return { kind: 'checking' };
		}
		if (!found.ok) {
			return { kind: 'unreadable', reason: found.reason === 'sign-in-required' ? 'sign-in-required' : 'other' };
		}
		if (!found.proposal) {
			return { kind: 'not-asked' };
		}
		// A proposal name can be used again after an earlier proposal ended. A pull request that already
		// ended belongs to an earlier proposal when this window saw this one before its first send and
		// has not seen its review open since.
		const ended = found.proposal.state === 'accepted' || found.proposal.state === 'closed';
		if (ended && this._seen?.branch === proposal.branch && this._seen.seenUnsent && !this._seen.reviewSeen) {
			return { kind: 'not-asked' };
		}
		return { kind: 'known', info: found.proposal };
	}

	get reviewRequired(): boolean {
		return this._reviewRequired && !this._engineState?.proposal && gitHubProject(this._github, this._engineState) !== undefined;
	}

	canAsk(): boolean {
		const state = this._engineState;
		return state !== undefined
			&& state.tracking === 'tracking'
			&& state.unusual === undefined
			&& state.proposal === undefined
			&& state.shared.exists
			&& state.shared.ahead > 0
			&& gitHubProject(this._github, state) !== undefined;
	}

	lastAsk(): IAskDraft | undefined {
		const draft = this._lastAsk;
		if (!draft || draft.branch !== this._engineState?.proposal?.branch) {
			return undefined;
		}
		return { title: draft.title, body: draft.body, count: draft.count };
	}

	async ask(title: string, body: string, onStep: (step: AskStep) => void, count?: number): Promise<AskResult> {
		let state = await this._readState();
		if (!state) {
			return { ok: false, failedStep: 'starting', message: Strings.proposals.startFailed(Strings.status.couldNotRead()) };
		}
		const project = gitHubProject(this._github, state);
		if (!project) {
			return { ok: false, failedStep: 'starting', message: Strings.proposals.startFailed(Strings.results.rejected('no-shared-copy')) };
		}

		const draft = { branch: state.proposal?.branch, title, body, count };
		this._lastAsk = draft;

		if (!state.proposal) {
			onStep('starting');
			const hostBase = this._pendingHostBase;
			const started = await this._run(async engine => {
				const result = await engine.startProposal();
				// The engine's detail names Finish, so the result is shown with the detail that names asking.
				return result.kind === 'unavailable' && result.detail === 'get-changes-first' ? { ...result, detail: 'get-changes-before-ask' } : result;
			});
			if (started?.kind === 'unavailable' && started.detail === 'get-changes-before-ask') {
				return { ok: false, failedStep: 'starting', message: this._sentence(started) };
			}
			if (started?.kind !== 'done') {
				return { ok: false, failedStep: 'starting', message: Strings.proposals.startFailed(this._sentence(started)) };
			}
			this._reviewRequired = false;
			state = await this._readState();
			if (!state?.proposal) {
				// The proposal exists; only its state could not be read, so the send did not start.
				return { ok: false, failedStep: 'sending', message: Strings.proposals.sendFailed(Strings.status.couldNotRead()) };
			}
			draft.branch = state.proposal.branch;
			if (this._seen?.branch === state.proposal.branch && this._seen.hostBase === undefined) {
				this._seen.hostBase = hostBase;
			}
			this._onDidChange.fire();
		}
		const proposal = state.proposal;

		if (!proposal.sent) {
			onStep('sending');
			const sent = await this._run(engine => engine.sendChanges());
			if (sent?.kind !== 'done') {
				await this._readState();
				return { ok: false, failedStep: 'sending', message: Strings.proposals.sendFailed(this._sentence(sent)) };
			}
		}

		// A pull request that is open for the branch already asks for the review; GitHub refuses a second one.
		const current = this.state;
		if (current.kind !== 'known' || !OPEN_STATES.has(current.info.state)) {
			onStep('asking');
			const base = (this._seen?.branch === proposal.branch ? this._seen.hostBase : undefined) ?? proposal.base;
			const opened = await this._github.openProposal(project.owner, project.name, proposal.branch, base, title, body);
			if (!opened.ok && opened.reason !== 'already-open') {
				await this.refresh();
				return { ok: false, failedStep: 'asking', message: Strings.proposals.askFailed(Strings.proposals.gitHubFailure(opened.reason)) };
			}
			if (this._seen?.branch === proposal.branch) {
				this._seen.reviewSeen = true;
			}
		}
		this._lastAsk = undefined;
		await this.refresh();
		return { ok: true };
	}

	async refresh(): Promise<void> {
		const state = await this._readState();
		const proposal = state?.proposal;
		if (!state || !proposal?.sent) {
			return;
		}
		await this._find(state, proposal.branch);
	}

	async send(): Promise<OperationResult | undefined> {
		const wasSent = this._engineState?.proposal?.sent === true;
		const result = await this._run(engine => engine.sendChanges());
		// Sending more changes to a proposal can change its review, so GitHub is asked again.
		await (wasSent ? this.refresh() : this._readState());
		if (result?.kind === 'rejected' && result.reason === 'review-required' && gitHubProject(this._github, this._engineState) !== undefined) {
			this._reviewRequired = true;
			this._onDidChange.fire();
		}
		return result;
	}

	async finish(): Promise<OperationResult | undefined> {
		const current = this.state;
		if (current.kind !== 'known' || current.info.state !== 'accepted') {
			return undefined;
		}
		// The engine compares the accepted commit with the shared copy as last read, so it is read first.
		const checked = await this._run(engine => engine.checkShared());
		if (checked?.kind !== 'done') {
			return checked;
		}
		const finished = await this._run(engine => engine.finishProposal(current.info.headCommit));
		if (finished?.kind !== 'done') {
			await this.refresh();
			return finished;
		}
		await this._readState();
		await this._syncController.refreshPreview();
		const result = await this._syncController.getChanges();
		await this.refresh();
		return result;
	}

	async stop(): Promise<{ engine: OperationResult | undefined; closedOnGitHub: boolean }> {
		const before = this.state;
		const project = gitHubProject(this._github, this._engineState);
		const stopped = await this._run(async engine => {
			const result = await engine.stopProposal();
			// The engine's detail names Finish, so the result is shown with the detail that names Stop.
			return result.kind === 'unavailable' && result.detail === 'get-changes-first' ? { ...result, detail: 'get-changes-before-stop' } : result;
		});
		if (stopped?.kind !== 'done') {
			await this.refresh();
			return { engine: stopped, closedOnGitHub: false };
		}
		let closedOnGitHub = false;
		if (before.kind === 'known' && OPEN_STATES.has(before.info.state) && project) {
			const closed = await this._github.closeProposal(project.owner, project.name, before.info.number);
			if (closed.ok) {
				closedOnGitHub = true;
			} else {
				this._logService.warn(`[Checkpoints] The proposal could not be closed on GitHub: ${closed.reason} ${closed.detail}`);
				this._notClosedUrl = before.info.url;
				this._messageService.show(Strings.proposals.notClosed());
			}
		}
		await this.refresh();
		this._onDidChange.fire();
		return { engine: stopped, closedOnGitHub };
	}

	dismiss(): void {
		if (this._reviewRequired || this._notClosedUrl !== undefined) {
			this._reviewRequired = false;
			this._notClosedUrl = undefined;
			this._onDidChange.fire();
		}
	}

	/** Runs one engine call through `runAction`, which shows its result on the status line. Start, send, finish, and stop write no files. */
	private _run(call: RunActionCall): Promise<OperationResult | undefined> {
		return this._instantiationService.invokeFunction(accessor => runAction(accessor, 'no-guard', call));
	}

	/** The sentence for an engine result that is not a success. */
	private _sentence(result: OperationResult | undefined): string {
		return (result && Strings.results.forOperation(result)) ?? Strings.results.couldNotFinish();
	}

	/**
	 * Reads the engine state and updates the card state and the context key. When a sent proposal
	 * has no answer from GitHub yet, it asks GitHub. A failed read keeps the previous state.
	 */
	private async _readState(): Promise<IEngineState | undefined> {
		const request = ++this._stateRequest;
		const engine = this._checkpointsService.engine;
		let state: IEngineState | undefined;
		if (engine) {
			try {
				state = await engine.getState();
			} catch (error) {
				this._logService.error('The state of the proposal could not be read.', error);
				return undefined;
			}
		}
		if (request !== this._stateRequest || this._store.isDisposed) {
			return state;
		}
		this._engineState = state;
		this._noteProposal(state);
		this._canAskKey.set(this.canAsk());
		this._onDidChange.fire();
		const proposal = state?.proposal;
		if (state && proposal?.sent && this._found?.branch !== proposal.branch && this._finding !== proposal.branch) {
			void this._find(state, proposal.branch);
		}
		return state;
	}

	/** Keeps what this window saw of the current proposal, and forgets the answers about any other. */
	private _noteProposal(state: IEngineState | undefined): void {
		const proposal = state?.proposal;
		if (!proposal) {
			this._found = undefined;
			this._seen = undefined;
			if (this._lastAsk?.branch !== undefined) {
				this._lastAsk = undefined;
			}
			// Before a proposal starts, the shared copy is the base branch's upstream.
			this._pendingHostBase = hostBranchName(state?.shared.name);
			return;
		}
		this._notClosedUrl = undefined;
		if (this._found && this._found.branch !== proposal.branch) {
			this._found = undefined;
		}
		if (this._seen?.branch !== proposal.branch) {
			this._seen = { branch: proposal.branch, seenUnsent: !proposal.sent, reviewSeen: false };
		}
		if (!proposal.sent) {
			// Before the first send, the shared copy is the base branch's upstream.
			this._seen.hostBase = hostBranchName(state.shared.name) ?? this._seen.hostBase;
		}
	}

	/** Asks GitHub for the newest pull request of `branch`. */
	private async _find(state: IEngineState, branch: string): Promise<void> {
		const project = gitHubProject(this._github, state);
		const request = ++this._findRequest;
		this._finding = branch;
		let result: FindProposalResult;
		try {
			result = project
				? await this._github.findProposal(project.owner, project.name, branch)
				: { ok: false, reason: 'unknown', detail: 'The shared copy is not on GitHub.' };
		} finally {
			if (request === this._findRequest) {
				this._finding = undefined;
			}
		}
		if (request !== this._findRequest || this._store.isDisposed) {
			return;
		}
		this._found = { branch, result };
		if (result.ok && result.proposal && OPEN_STATES.has(result.proposal.state) && this._seen?.branch === branch) {
			this._seen.reviewSeen = true;
		}
		this._onDidChange.fire();
	}
}

registerSingleton(IProposalController, ProposalController, InstantiationType.Delayed);
