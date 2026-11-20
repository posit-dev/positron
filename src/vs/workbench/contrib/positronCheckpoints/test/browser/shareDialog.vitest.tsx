/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Event } from '../../../../../base/common/event.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { AuthenticationSession, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { CreateRepositoryResult, IGitHubClient, InviteResult, parseProjectLink } from '../../browser/github/githubClient.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { IProposalController } from '../../browser/proposalController.js';
import { createProposalController } from './proposalTestHelpers.js';
import { FORBIDDEN_WORDS } from '../../common/forbiddenWords.js';
import { FakeCheckpointsEngine, fakeCheckpoint, fakeEngineState } from './fakeCheckpointsEngine.js';

const CLONE_URL = 'https://github.com/me/dose-model.git';
const WEB_URL = 'https://github.com/me/dose-model';

describe('ShareDialog', () => {
	let createRepository: ReturnType<typeof vi.fn<IGitHubClient['createRepository']>>;
	let invite: ReturnType<typeof vi.fn<IGitHubClient['invite']>>;
	let createSession: ReturnType<typeof vi.fn<IAuthenticationService['createSession']>>;
	let writeText: ReturnType<typeof vi.fn<IClipboardService['writeText']>>;

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IGitHubClient, {
			createRepository: (...args: Parameters<IGitHubClient['createRepository']>) => createRepository(...args),
			invite: (...args: Parameters<IGitHubClient['invite']>) => invite(...args),
			parseProjectLink,
		})
		.stub(IAuthenticationService, stubInterface<IAuthenticationService>({
			createSession: (...args: Parameters<IAuthenticationService['createSession']>) => createSession(...args),
		}))
		.stub(IClipboardService, { writeText: (...args: Parameters<IClipboardService['writeText']>) => writeText(...args) })
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;

	beforeEach(() => {
		createRepository = vi.fn<IGitHubClient['createRepository']>(async () => ({ ok: true, cloneUrl: CLONE_URL, htmlUrl: WEB_URL }));
		invite = vi.fn<IGitHubClient['invite']>(async () => ({ ok: true }));
		createSession = vi.fn<IAuthenticationService['createSession']>(async () => stubInterface<AuthenticationSession>({ accessToken: 'token' }));
		writeText = vi.fn<IClipboardService['writeText']>(async () => { });
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		engine.state = fakeEngineState({ shared: { exists: false, ahead: 0, behind: 0 } });
		engine.history = [fakeCheckpoint({ shared: false })];
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const close = screen.queryByRole('button', { name: 'Cancel' }) ?? screen.queryByRole('button', { name: 'Close' });
		if (close) {
			await userEvent.click(close);
		}
	});

	async function openDialog() {
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Share This Project' }));
		const dialog = await screen.findByRole('dialog');
		return { user, dialog };
	}

	/** Fills the form and clicks Share. */
	async function share(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, fields: { name?: string; organization?: string; colleague?: string } = {}) {
		if (fields.name !== undefined) {
			await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
			await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), fields.name);
		}
		if (fields.organization) {
			await user.type(within(dialog).getByRole('textbox', { name: 'Organization' }), fields.organization);
		}
		if (fields.colleague) {
			await user.type(within(dialog).getByRole('textbox', { name: 'Invite a colleague (optional)' }), fields.colleague);
		}
		await user.click(within(dialog).getByRole('button', { name: 'Share' }));
	}

	function expectNoGitWords(dialog: HTMLElement) {
		expect(dialog).not.toHaveTextContent(FORBIDDEN_WORDS);
	}

	test('the action appears only while the project is only on this computer', async () => {
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 0, behind: 0 } });
		rtl.render(<CheckpointsPanel />);

		expect(await screen.findByText('You have everything in the shared copy.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Share This Project' })).not.toBeInTheDocument();
	});

	test('the form starts with the folder name, a private project, and no organization or colleague', async () => {
		const { dialog } = await openDialog();

		expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('dose-model');
		expect(within(dialog).getByRole('textbox', { name: 'Organization' })).toHaveValue('');
		expect(within(dialog).getByText('Leave empty to share under your own account.')).toBeInTheDocument();
		expect(within(dialog).getByRole('checkbox', { name: 'Only people I invite can see this project' })).toBeChecked();
		expect(within(dialog).getByRole('textbox', { name: 'Invite a colleague (optional)' })).toHaveValue('');
		expect(within(dialog).getByText('Enter the person\'s GitHub user name.')).toBeInTheDocument();
		expectNoGitWords(dialog);
	});

	test('an email address in the colleague field disables Share before anything is created', async () => {
		const { user, dialog } = await openDialog();

		await user.type(within(dialog).getByRole('textbox', { name: 'Invite a colleague (optional)' }), 'maya@example.org');

		expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
		expect(await within(dialog).findAllByText('Enter the person\'s GitHub user name.')).toHaveLength(2);
		expect(createRepository).not.toHaveBeenCalled();
	});

	test('sharing without a colleague creates the project, links it, and shows the link', async () => {
		const { user, dialog } = await openDialog();

		await share(user, dialog);

		expect(await within(dialog).findByText('This project is shared.')).toBeInTheDocument();
		expect(createRepository).toHaveBeenCalledWith('dose-model', true, undefined);
		expect(engine.callsOf('connectSharedCopy')).toEqual([[CLONE_URL]]);
		expect(invite).not.toHaveBeenCalled();
		expect(within(dialog).getByText(`Send this link to your colleague: ${WEB_URL}`)).toBeInTheDocument();
		expectNoGitWords(dialog);

		await user.click(within(dialog).getByRole('button', { name: 'Copy Link' }));
		expect(writeText).toHaveBeenCalledWith(WEB_URL);
	});

	test('the steps run in order, and the inputs of the form reach the client', async () => {
		const order: string[] = [];
		createRepository.mockImplementation(async () => { order.push('create'); return { ok: true, cloneUrl: 'https://github.com/acme/model.git', htmlUrl: 'https://github.com/acme/model' }; });
		const connect = engine.connectSharedCopy.bind(engine);
		engine.connectSharedCopy = async url => { order.push('connect'); return connect(url); };
		invite.mockImplementation(async () => { order.push('invite'); return { ok: true }; });
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('checkbox', { name: 'Only people I invite can see this project' }));
		await share(user, dialog, { name: 'model', organization: 'acme', colleague: 'maya-ortiz' });

		expect(await within(dialog).findByText('This project is shared.')).toBeInTheDocument();
		expect(order).toEqual(['create', 'connect', 'invite']);
		expect(createRepository).toHaveBeenCalledWith('model', false, 'acme');
		expect(invite).toHaveBeenCalledWith('acme', 'model', 'maya-ortiz');
		expect(within(dialog).getByText('maya-ortiz has an invitation by email and on GitHub.')).toBeInTheDocument();
	});

	test('progress is stated as one sentence for each step', async () => {
		let finishCreate!: (result: CreateRepositoryResult) => void;
		createRepository.mockImplementation(() => new Promise(resolve => { finishCreate = resolve; }));
		let finishConnect!: () => void;
		engine.connectSharedCopy = () => new Promise(resolve => { finishConnect = () => resolve({ kind: 'done', operationId: 'op', hookEditedFiles: [] }); });
		let finishInvite!: (result: InviteResult) => void;
		invite.mockImplementation(() => new Promise(resolve => { finishInvite = resolve; }));
		const { user, dialog } = await openDialog();

		await share(user, dialog, { colleague: 'maya-ortiz' });
		expect(await within(dialog).findByText('Creating the project on GitHub...')).toBeInTheDocument();
		finishCreate({ ok: true, cloneUrl: CLONE_URL, htmlUrl: WEB_URL });
		expect(await within(dialog).findByText('Copying your versions to GitHub...')).toBeInTheDocument();
		await vi.waitFor(() => expect(finishConnect).toBeDefined());
		finishConnect();
		expect(await within(dialog).findByText('Inviting maya-ortiz...')).toBeInTheDocument();
		finishInvite({ ok: true });
		expect(await within(dialog).findByText('This project is shared.')).toBeInTheDocument();
	});

	describe('signing in', () => {
		test('without a sign-in the dialog offers Sign in to GitHub, and nothing signs in before the click', async () => {
			createRepository.mockResolvedValueOnce({ ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' });
			const { user, dialog } = await openDialog();

			await share(user, dialog);

			expect(await within(dialog).findByText('Sign in to GitHub to share this project.')).toBeInTheDocument();
			expect(createSession).not.toHaveBeenCalled();
			expect(engine.callsOf('connectSharedCopy')).toEqual([]);

			await user.click(within(dialog).getByRole('button', { name: 'Sign In to GitHub' }));

			expect(await within(dialog).findByText('This project is shared.')).toBeInTheDocument();
			expect(createSession).toHaveBeenCalledWith('github', ['repo']);
			expect(createRepository).toHaveBeenCalledTimes(2);
			expectNoGitWords(dialog);
		});

		test('a sign-in that is not completed says nothing was changed and offers the button again', async () => {
			createRepository.mockResolvedValue({ ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' });
			createSession.mockRejectedValueOnce(new Error('cancelled'));
			const { user, dialog } = await openDialog();

			await share(user, dialog);
			await user.click(await within(dialog).findByRole('button', { name: 'Sign In to GitHub' }));

			expect(await within(dialog).findByText('Positron did not get a GitHub sign-in. Nothing was changed.')).toBeInTheDocument();
			expect(createRepository).toHaveBeenCalledTimes(1);
			expect(within(dialog).getByRole('button', { name: 'Sign In to GitHub' })).toBeEnabled();
		});

		test('a sign-in lost before the invitation signs in again and invites without creating a second project', async () => {
			invite.mockResolvedValueOnce({ ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' });
			const { user, dialog } = await openDialog();

			await share(user, dialog, { colleague: 'maya-ortiz' });
			expect(await within(dialog).findByText('The project is shared, but the GitHub sign-in ended before the invitation. Sign in again to invite maya-ortiz.')).toBeInTheDocument();
			expect(within(dialog).getByText(`The project is at ${WEB_URL}`)).toBeInTheDocument();
			expect(createSession).not.toHaveBeenCalled();

			await user.click(within(dialog).getByRole('button', { name: 'Sign In to GitHub' }));

			expect(await within(dialog).findByText('maya-ortiz has an invitation by email and on GitHub.')).toBeInTheDocument();
			expect(createSession).toHaveBeenCalledWith('github', ['repo']);
			expect(createRepository).toHaveBeenCalledTimes(1);
			expect(engine.callsOf('connectSharedCopy')).toHaveLength(1);
			expect(invite).toHaveBeenCalledTimes(2);
		});
	});

	describe('before anything is created', () => {
		test('a project with no checkpoints asks for one first and creates nothing', async () => {
			engine.history = [];
			const { user, dialog } = await openDialog();

			await share(user, dialog);

			expect(await within(dialog).findByText('Save a version first, then share.')).toBeInTheDocument();
			expect(createRepository).not.toHaveBeenCalled();
			expect(engine.callsOf('connectSharedCopy')).toEqual([]);
		});

		test('the project is read once before the project is created', async () => {
			const { user, dialog } = await openDialog();

			await share(user, dialog);

			expect(await within(dialog).findByText('This project is shared.')).toBeInTheDocument();
			expect(engine.callsOf('getHistory')).toContainEqual([0, 1]);
		});
	});

	describe('when the project cannot be created', () => {
		const failures: { name: string; result: CreateRepositoryResult; organization?: string; sentence: string }[] = [
			{ name: 'no connection', result: { ok: false, reason: 'offline', detail: 'x' }, sentence: 'GitHub did not answer. The project may have been created; check your GitHub account before trying again.' },
			{ name: 'a reply that cannot be read', result: { ok: false, reason: 'maybe-created', detail: 'x' }, sentence: 'GitHub did not answer. The project may have been created; check your GitHub account before trying again.' },
			{ name: 'a name in use', result: { ok: false, reason: 'name-taken', detail: 'x' }, sentence: 'You already have a project named dose-model on GitHub. Choose another name. Nothing was changed.' },
			{ name: 'an organization that refuses', result: { ok: false, reason: 'not-allowed', detail: 'x' }, organization: 'acme', sentence: 'GitHub does not let your account create projects in acme. Ask an owner of acme to allow it, or leave Organization empty. Nothing was changed.' },
			{ name: 'an account that refuses', result: { ok: false, reason: 'not-allowed', detail: 'x' }, sentence: 'GitHub does not let your account create projects. Nothing was changed.' },
			{ name: 'any other answer', result: { ok: false, reason: 'unknown', detail: 'GitHub replied 500.' }, sentence: 'GitHub could not create the project. Nothing was changed. GitHub replied 500.' },
		];

		test.each(failures)('$name keeps the form open with its own sentence and links nothing', async ({ result, organization, sentence }) => {
			createRepository.mockResolvedValueOnce(result);
			const { user, dialog } = await openDialog();

			await share(user, dialog, { organization });

			expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
			expect(engine.callsOf('connectSharedCopy')).toEqual([]);
			expect(invite).not.toHaveBeenCalled();
			expect(within(dialog).getByRole('textbox', { name: 'Name' })).toBeEnabled();
			expectNoGitWords(dialog);
		});

		test('the person can choose another name and share again', async () => {
			createRepository.mockResolvedValueOnce({ ok: false, reason: 'name-taken', detail: 'x' });
			const { user, dialog } = await openDialog();

			await share(user, dialog);
			expect(await within(dialog).findByText(/You already have a project named dose-model/)).toBeInTheDocument();
			await share(user, dialog, { name: 'dose-model-2' });

			expect(await within(dialog).findByText('This project is shared.')).toBeInTheDocument();
			expect(createRepository).toHaveBeenLastCalledWith('dose-model-2', true, undefined);
		});
	});

	describe('when linking fails after the project was created', () => {
		test('the dialog says what was done, keeps the link, and Try again runs the link step only', async () => {
			engine.queuedResults = [{ kind: 'rejected', reason: 'offline', detail: 'unreachable' }];
			const { user, dialog } = await openDialog();

			await share(user, dialog, { colleague: 'maya-ortiz' });

			expect(await within(dialog).findByText('The project dose-model was created on GitHub, but Positron could not copy your versions to it. Your files are safe. Select Try Again.')).toBeInTheDocument();
			expect(within(dialog).getByText(`The project is at ${WEB_URL}`)).toBeInTheDocument();
			expect(invite).not.toHaveBeenCalled();
			expectNoGitWords(dialog);

			await user.click(within(dialog).getByRole('button', { name: 'Try Again' }));

			expect(await within(dialog).findByText('This project is shared.')).toBeInTheDocument();
			expect(createRepository).toHaveBeenCalledTimes(1);
			expect(engine.callsOf('connectSharedCopy')).toEqual([[CLONE_URL], [CLONE_URL]]);
			expect(invite).toHaveBeenCalledTimes(1);
		});

		test('an engine call that fails to run is treated the same way', async () => {
			engine.connectSharedCopy = async () => { throw new Error('engine gone'); };
			const { user, dialog } = await openDialog();

			await share(user, dialog);

			expect(await within(dialog).findByText(/was created on GitHub, but Positron could not copy your versions to it/)).toBeInTheDocument();
			expect(within(dialog).getByRole('button', { name: 'Try Again' })).toBeEnabled();
		});

		test.each([
			{ detail: 'origin-exists', reason: 'this folder is already linked to a different shared copy.' },
			{ detail: 'no-checkpoints', reason: 'this folder has no versions yet. Save a version, then link it.' },
			{ detail: 'already-shared', reason: 'this project is already shared.' },
			{ detail: 'bad-link', reason: 'the link GitHub gave is not one Positron can use.' },
			{ detail: 'inside-another-project', reason: 'this folder is inside another project that keeps its own versions. Share that project instead.' },
		])('a permanent refusal ($detail) has its own sentence, keeps the link, and offers no retry', async ({ detail, reason }) => {
			engine.queuedResults = [{ kind: 'unavailable', reason: 'nothing-to-do', detail }];
			const { user, dialog } = await openDialog();

			await share(user, dialog);

			expect(await within(dialog).findByText(`A project was created on GitHub, but this folder could not be linked to it: ${reason}`)).toBeInTheDocument();
			expect(within(dialog).queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
			expect(within(dialog).getByText(`The project is at ${WEB_URL}`)).toBeInTheDocument();
			expect(engine.callsOf('connectSharedCopy')).toHaveLength(1);
			expectNoGitWords(dialog);
		});

		test('a web link that cannot be validated is never given to the engine', async () => {
			createRepository.mockResolvedValueOnce({ ok: true, cloneUrl: 'https://evil.example/me/dose-model.git', htmlUrl: WEB_URL });
			const { user, dialog } = await openDialog();

			await share(user, dialog);

			expect(await within(dialog).findByText('A project was created on GitHub, but this folder could not be linked to it: the link GitHub gave is not one Positron can use.')).toBeInTheDocument();
			expect(engine.callsOf('connectSharedCopy')).toEqual([]);
			expect(within(dialog).queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
		});
	});

	describe('when the invitation fails after the project was linked', () => {
		const failures: { name: string; result: InviteResult; sentence: string; retry: boolean }[] = [
			{ name: 'no such user', result: { ok: false, reason: 'no-such-user', detail: 'x' }, sentence: `The project is shared, but there is no GitHub user named maya-ortiz. Send this link instead: ${WEB_URL}`, retry: false },
			{ name: 'a refusal', result: { ok: false, reason: 'not-allowed', detail: 'x' }, sentence: `The project is shared, but GitHub does not let your account invite people to it. Send this link instead: ${WEB_URL}`, retry: false },
			{ name: 'any other answer', result: { ok: false, reason: 'unknown', detail: 'x' }, sentence: `The project is shared, but the invitation to maya-ortiz failed. Send this link instead: ${WEB_URL}`, retry: true },
		];

		test.each(failures)('$name has its own sentence with the link', async ({ result, sentence, retry }) => {
			invite.mockResolvedValueOnce(result);
			const { user, dialog } = await openDialog();

			await share(user, dialog, { colleague: 'maya-ortiz' });

			expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
			expect(engine.callsOf('connectSharedCopy')).toEqual([[CLONE_URL]]);
			expect(within(dialog).queryByRole('button', { name: 'Try Again' }) !== null).toBe(retry);
			expectNoGitWords(dialog);
		});

		test('Try again after an invitation that failed invites without creating or linking again', async () => {
			invite.mockResolvedValueOnce({ ok: false, reason: 'unknown', detail: 'x' });
			const { user, dialog } = await openDialog();

			await share(user, dialog, { colleague: 'maya-ortiz' });
			await user.click(await within(dialog).findByRole('button', { name: 'Try Again' }));

			expect(await within(dialog).findByText('maya-ortiz has an invitation by email and on GitHub.')).toBeInTheDocument();
			expect(createRepository).toHaveBeenCalledTimes(1);
			expect(engine.callsOf('connectSharedCopy')).toHaveLength(1);
			expect(invite).toHaveBeenCalledTimes(2);
		});
	});

	test('Cancel closes the form and creates nothing', async () => {
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(createRepository).not.toHaveBeenCalled();
	});
});
