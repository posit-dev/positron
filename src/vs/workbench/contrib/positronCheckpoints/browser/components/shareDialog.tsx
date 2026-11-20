/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useRef, useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { readFailureKind } from '../../common/readFailure.js';
import { CreateRepositoryResult, IGitHubClient, InviteResult } from '../github/githubClient.js';
import { useRunAction } from './useRunAction.js';

const SHARE_DIALOG_WIDTH = 560;
const SHARE_DIALOG_HEIGHT = 540;

const GITHUB_PROVIDER_ID = 'github';
const GITHUB_SCOPES = ['repo'];

/**
 * The details of the engine's `unavailable` answer to a link request that no second attempt
 * changes, because the folder or the link itself is the cause.
 */
const PERMANENT_LINK_DETAILS: ReadonlySet<string> = new Set(['origin-exists', 'no-checkpoints', 'already-shared', 'bad-link', 'inside-another-project']);

/** The reasons of an `unavailable` answer that describe the state of the folder, which no second attempt changes. */
const PERMANENT_LINK_REASONS: ReadonlySet<string> = new Set(['unusual-state', 'not-tracking']);

/** What the caller gives the dialog. */
export interface IShareDialogOptions {
	/** The folder name of the project, which is the proposed name of the shared copy. */
	projectName: string;
}

/** Opens the dialog that puts a copy of the project on GitHub and links this project to it. */
export function showShareDialog(options: IShareDialogOptions): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<ShareDialog {...options} renderer={renderer} />);
}

interface IShareDialogProps extends IShareDialogOptions {
	renderer: PositronModalReactRenderer;
}

/** The project that was created on GitHub. */
interface ICreatedProject {
	owner: string;
	name: string;
	/** The validated link the folder is linked to. Empty when GitHub returned a link that is not usable. */
	cloneUrl: string;
	htmlUrl: string;
}

/** The steps that are done, kept across attempts so that a retry runs the failed step only. */
interface IShareProgress {
	created?: ICreatedProject;
	connected: boolean;
	invited: boolean;
}

/** Why the flow stopped, and what the person can do next. */
interface IStop {
	sentence: string;
	/** True when the stopped step can run again. */
	canRetry: boolean;
	/** True when the next click starts a GitHub sign-in before the step runs again. */
	needsSignIn: boolean;
}

/**
 * Where the dialog is: asking, running the steps in order, stopped at a step that failed after
 * the project was created or that needs a sign-in, or finished.
 */
type Phase = 'form' | 'running' | 'stopped' | 'done';

/** True when `text` looks like an email address instead of a GitHub user name. */
function looksLikeEmail(text: string): boolean {
	return text.includes('@');
}

/** The sentence for a refused request to create the project. Nothing was created. */
function createFailureSentence(result: Extract<CreateRepositoryResult, { ok: false }>, name: string, owner: string): string {
	switch (result.reason) {
		case 'name-taken':
			return Strings.share.nameTaken(name);
		case 'not-allowed':
			return owner !== '' ? Strings.share.organizationRefuses(owner) : Strings.share.accountRefuses();
		case 'offline':
		case 'maybe-created':
			return Strings.share.noAnswer();
		case 'sign-in-required':
		case 'unknown':
			return Strings.share.createFailed(result.detail);
	}
}

/** What to tell the person, and offer, after a failed invitation. */
function inviteFailure(result: Extract<InviteResult, { ok: false }>, login: string, link: string): IStop {
	switch (result.reason) {
		case 'no-such-user':
			return {
				sentence: looksLikeEmail(login) ? Strings.share.emailEntered() : Strings.share.noSuchUser(login, link),
				canRetry: false,
				needsSignIn: false,
			};
		case 'not-allowed':
			return { sentence: Strings.share.inviteNotAllowed(link), canRetry: false, needsSignIn: false };
		case 'sign-in-required':
			return { sentence: Strings.share.signInLost(login), canRetry: true, needsSignIn: true };
		case 'unknown':
			return { sentence: Strings.share.inviteFailed(login, link), canRetry: true, needsSignIn: false };
	}
}

/**
 * Shares the project in three steps that run in order after one click on Share: create the
 * project on GitHub, link this project to it, and invite a colleague when one was named. The
 * dialog states each step as a sentence. When a step fails after the project was created, the
 * dialog says what was done and what was not, keeps the link to the created project, and offers
 * Try again for the failed step only, so a second project is never created. Signing in to GitHub
 * starts only from the Sign in to GitHub click.
 */
export const ShareDialog = (props: IShareDialogProps) => {
	const services = usePositronReactServicesContext();
	const runAction = useRunAction();
	const [name, setName] = useState(props.projectName);
	const [organization, setOrganization] = useState('');
	const [isPrivate, setIsPrivate] = useState(true);
	const [colleague, setColleague] = useState('');
	const [phase, setPhase] = useState<Phase>('form');
	const [progressSentence, setProgressSentence] = useState<string>();
	const [problem, setProblem] = useState<string>();
	const [stop, setStop] = useState<IStop>();
	const progress = useRef<IShareProgress>({ connected: false, invited: false });
	const [created, setCreated] = useState<ICreatedProject>();

	const login = colleague.trim();
	const colleagueProblem = looksLikeEmail(login) ? Strings.share.inviteHelp() : undefined;
	const formReady = name.trim() !== '' && colleagueProblem === undefined;

	/** Stops at a step that needs the person: a failed step, or a sign-in. */
	const stopWith = (reason: IStop) => {
		setStop(reason);
		setPhase('stopped');
	};

	/**
	 * Reads the project before anything is created. Returns the sentence that says why it cannot be
	 * shared, or undefined when a shared copy can be linked.
	 */
	const checkProjectCanBeShared = async (): Promise<string | undefined> => {
		const engine = services.get(ICheckpointsService).engine;
		if (!engine) {
			return Strings.status.noEngine();
		}
		try {
			const state = await engine.getState();
			if (state.shared.exists) {
				return Strings.share.alreadyShared();
			}
			if (state.tracking !== 'tracking') {
				return Strings.results.unavailable('not-tracking');
			}
			const history = await engine.getHistory(0, 1);
			return history.length === 0 ? Strings.share.createFirst() : undefined;
		} catch (error) {
			services.get(ILogService).error('[Checkpoints] The project could not be read before sharing.', error);
			return Strings.status.couldNotLoad(readFailureKind(error));
		}
	};

	/** Runs the steps that are not done yet, in order, and stops at the first that fails. */
	const run = async () => {
		const github = services.get(IGitHubClient);
		setPhase('running');
		setProblem(undefined);
		setStop(undefined);

		if (!progress.current.created) {
			// Nothing is created on GitHub before the project is known to accept a link to it.
			const refusal = await checkProjectCanBeShared();
			if (refusal !== undefined) {
				setProblem(refusal);
				setPhase('form');
				return;
			}
			setProgressSentence(Strings.share.creating());
			const trimmedName = name.trim();
			const owner = organization.trim();
			const result = await github.createRepository(trimmedName, isPrivate, owner === '' ? undefined : owner);
			if (!result.ok) {
				if (result.reason === 'sign-in-required') {
					stopWith({ sentence: Strings.share.signInNeeded(), canRetry: false, needsSignIn: true });
				} else {
					setProblem(createFailureSentence(result, trimmedName, owner));
					setPhase('form');
				}
				return;
			}
			// Only the validated link is given to the engine, never the text of GitHub's reply.
			const link = github.parseProjectLink(result.cloneUrl);
			progress.current.created = {
				owner: link?.owner ?? owner,
				name: link?.name ?? trimmedName,
				cloneUrl: link?.cloneUrl ?? '',
				htmlUrl: result.htmlUrl,
			};
			setCreated(progress.current.created);
		}
		const project = progress.current.created;

		if (!progress.current.connected) {
			if (project.cloneUrl === '') {
				stopWith({ sentence: Strings.share.notLinked(Strings.share.notLinkedReason('bad-link')), canRetry: false, needsSignIn: false });
				return;
			}
			setProgressSentence(Strings.share.copying());
			const connected = await runAction('no-guard', engine => engine.connectSharedCopy(project.cloneUrl));
			if (connected?.kind === 'done') {
				progress.current.connected = true;
			} else if (connected?.kind === 'unavailable' && ((connected.detail !== undefined && PERMANENT_LINK_DETAILS.has(connected.detail)) || PERMANENT_LINK_REASONS.has(connected.reason))) {
				stopWith({ sentence: Strings.share.notLinked(Strings.share.notLinkedReason(connected.detail)), canRetry: false, needsSignIn: false });
				return;
			} else {
				stopWith({ sentence: Strings.share.copyFailed(project.name), canRetry: true, needsSignIn: false });
				return;
			}
		}

		if (login !== '' && !progress.current.invited) {
			setProgressSentence(Strings.share.inviting(login));
			const invited = await github.invite(project.owner, project.name, login);
			if (!invited.ok) {
				stopWith(inviteFailure(invited, login, project.htmlUrl));
				return;
			}
			progress.current.invited = true;
		}

		setPhase('done');
	};

	/** Starts the GitHub sign-in. Returns true when the person signed in. */
	const signIn = async (): Promise<boolean> => {
		try {
			await services.get(IAuthenticationService).createSession(GITHUB_PROVIDER_ID, GITHUB_SCOPES);
			return true;
		} catch (error) {
			services.get(ILogService).warn('[Checkpoints] The GitHub sign-in was not completed.', error instanceof Error ? error.message : String(error));
			return false;
		}
	};

	const copyLink = () => {
		if (created) {
			services.clipboardService.writeText(created.htmlUrl);
		}
	};

	const accept = async () => {
		switch (phase) {
			case 'form':
				if (formReady) {
					await run();
				}
				return;
			case 'stopped':
				if (stop?.needsSignIn) {
					if (!(await signIn())) {
						if (!created) {
							setStop({ sentence: Strings.share.signInMissing(), canRetry: false, needsSignIn: true });
						}
						return;
					}
					await run();
				} else if (stop?.canRetry) {
					await run();
				} else {
					copyLink();
				}
				return;
			case 'done':
				copyLink();
				return;
			case 'running':
				return;
		}
	};

	const cancel = () => {
		// A running step cannot be taken back, so the dialog stays until the step ends.
		if (phase !== 'running') {
			props.renderer.dispose();
		}
	};

	const okTitle = (() => {
		switch (phase) {
			case 'form':
			case 'running':
				return Strings.share.shareButton();
			case 'stopped':
				if (stop?.needsSignIn) {
					return Strings.share.signInButton();
				}
				return stop?.canRetry ? Strings.share.tryAgain() : Strings.share.copyLink();
			case 'done':
				return Strings.share.copyLink();
		}
	})();
	const finished = phase === 'done' || (phase === 'stopped' && !stop?.needsSignIn && !stop?.canRetry);
	// With no project created there is no link to copy.
	const okDisabled = phase === 'running' || (phase === 'form' && !formReady) || (finished && !created);
	const link = created?.htmlUrl;

	return (
		<OKCancelModalDialog
			cancelButtonTitle={phase === 'form' ? Strings.actions.cancel() : Strings.actions.close()}
			height={SHARE_DIALOG_HEIGHT}
			okButtonTitle={okTitle}
			okDisabled={okDisabled}
			renderer={props.renderer}
			title={Strings.share.dialogTitle()}
			width={SHARE_DIALOG_WIDTH}
			onAccept={accept}
			onCancel={cancel}
		>
			<div className='checkpoint-dialog'>
				{phase === 'form' && (
					<>
						{problem && <p className='checkpoint-dialog-warning' role='alert'>{problem}</p>}
						<LabeledTextInput
							autoFocus
							label={Strings.share.nameLabel()}
							value={name}
							onChange={e => setName(e.target.value)}
						/>
						<LabeledTextInput
							label={Strings.share.organizationLabel()}
							value={organization}
							onChange={e => setOrganization(e.target.value)}
						/>
						<p className='checkpoint-dialog-empty'>{Strings.share.organizationHelp()}</p>
						<label>
							<input checked={isPrivate} type='checkbox' onChange={e => setIsPrivate(e.target.checked)} />
							<span>{Strings.share.privateLabel()}</span>
						</label>
						<LabeledTextInput
							errorMsg={colleagueProblem}
							label={Strings.share.inviteLabel()}
							value={colleague}
							onChange={e => setColleague(e.target.value)}
						/>
						<p className='checkpoint-dialog-empty'>{Strings.share.inviteHelp()}</p>
					</>
				)}
				{phase === 'running' && (
					<p aria-live='polite' role='status'>{progressSentence}</p>
				)}
				{phase === 'stopped' && stop && (
					<>
						<p role='alert'>{stop.sentence}</p>
						{link && !stop.sentence.includes(link) && <p>{Strings.share.projectLink(link)}</p>}
					</>
				)}
				{phase === 'done' && link && (
					<>
						<p role='status'>{Strings.share.shared()}</p>
						<p>{Strings.share.sendLink(link)}</p>
						{login !== '' && <p>{Strings.share.invited(login)}</p>}
					</>
				)}
			</div>
		</OKCancelModalDialog>
	);
};
