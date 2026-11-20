/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDialogService, IPrompt } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { UnsavedEditorsDecision } from '../../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { GitDetails } from '../../browser/components/gitDetails.js';
import { IHistoryDescription } from '../../common/agent/describeHistory.js';
import { JobOutcome } from '../../common/agent/jobTypes.js';
import { FakeCheckpointsAgentService } from './fakeAgentService.js';
import { fakeCheckpoint, fakeEngineState, FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

const HOUR = 60 * 60 * 1000;

describe('History section', () => {
	let dirty: IWorkingCopy[] = [];
	let prompts: string[] = [];
	let promptButtons: string[][] = [];

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWorkingCopyService, {
			get dirtyWorkingCopies() { return dirty; },
			onDidRegister: new Emitter<IWorkingCopy>().event,
			onDidUnregister: new Emitter<IWorkingCopy>().event,
			onDidChangeDirty: new Emitter<IWorkingCopy>().event,
		})
		.stub(IUriIdentityService, { extUri })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.stub(IDialogService, {
			// Presses the first button of the unsaved-editors prompt, which saves the files.
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => {
				prompts.push(prompt.message);
				promptButtons.push(prompt.buttons!.map(button => button.label));
				return { result: await prompt.buttons![0].run({ checkboxChecked: false }) };
			},
		})
		.stub(IFileService, {})
		.stub(IEditorService, {})
		// The panel reads the agent service, which is off here, so no job runs.
		.stub(ICheckpointsAgentService, { available: false, onDidChangeAvailable: Event.None, pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.stub(ICheckpointsSuggestionService, { current: undefined, onDidChange: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;

	beforeEach(() => {
		dirty = [];
		prompts = [];
		promptButtons = [];
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const cancel = screen.queryByRole('button', { name: 'Cancel' });
		if (cancel) {
			await userEvent.click(cancel);
		}
	});

	function renderHistory(history: ICheckpoint[]) {
		engine.history = history;
		rtl.render(<CheckpointsPanel />);
	}

	async function expandRow(title: string) {
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: `Show details of ${title}` }));
		return user;
	}

	const mine = fakeCheckpoint({ id: 'c1', title: 'Mine', shared: false, time: new Date(Date.now() - 2 * HOUR).toISOString() });
	const theirs = fakeCheckpoint({ id: 'c2', title: 'Theirs', authorName: 'Maya', authorIsMe: false, shared: true });

	test('rows show You or the colleague name', async () => {
		renderHistory([mine, theirs]);

		const rows = await screen.findAllByRole('listitem');

		expect(within(rows[0]).getByText('You')).toBeInTheDocument();
		expect(within(rows[0]).getByText(/ago/)).toBeInTheDocument();
		expect(within(rows[1]).getByText('Maya')).toBeInTheDocument();
	});

	test('unshared checkpoints are marked and one Send action is shown', async () => {
		renderHistory([mine, fakeCheckpoint({ id: 'c3', title: 'Also mine', shared: false }), theirs]);
		const user = userEvent.setup();

		expect(await screen.findAllByText('not yet shared')).toHaveLength(2);
		await user.click(screen.getByRole('button', { name: 'Send Changes' }));

		await vi.waitFor(() => expect(engine.callsOf('sendChanges')).toHaveLength(1));
		expect(prompts).toEqual([]);
	});

	test('no Send action is shown when everything is shared', async () => {
		renderHistory([theirs]);

		expect(await screen.findByText('Theirs')).toBeInTheDocument();

		expect(screen.queryByRole('button', { name: 'Send Changes' })).not.toBeInTheDocument();
	});

	test('send rejected shared-copy-moved shows the get-changes-first sentence', async () => {
		engine.nextResult = { kind: 'rejected', reason: 'shared-copy-moved', detail: 'non-fast-forward' };
		renderHistory([mine]);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));

		expect(await screen.findByText('Someone added changes to the shared copy first. Get their changes, then send yours.')).toBeInTheDocument();
	});

	test('send rejected sign-in-required shows the sign-in sentence', async () => {
		engine.nextResult = { kind: 'rejected', reason: 'sign-in-required', detail: 'auth' };
		renderHistory([mine]);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Send Changes' }));

		expect(await screen.findByText('Sign in to the service that hosts the shared copy, then try again.')).toBeInTheDocument();
	});

	test('Edit description appears only for unshared checkpoints', async () => {
		renderHistory([mine, theirs]);

		await expandRow('Mine');
		expect(screen.getByRole('button', { name: 'Edit Description' })).toBeInTheDocument();
		await expandRow('Mine');
		await expandRow('Theirs');

		expect(screen.queryByRole('button', { name: 'Edit Description' })).not.toBeInTheDocument();
	});

	test('Edit description saves the trimmed title and body', async () => {
		renderHistory([fakeCheckpoint({ id: 'c1', title: 'Mine', body: 'Old', shared: false })]);
		const user = await expandRow('Mine');

		await user.click(screen.getByRole('button', { name: 'Edit Description' }));
		const title = await screen.findByRole('textbox', { name: 'Title' });
		await user.clear(title);
		await user.type(title, ' New title ');
		await user.click(screen.getByRole('button', { name: 'Save' }));

		await vi.waitFor(() => expect(engine.callsOf('editDescription')).toEqual([['c1', 'New title', 'Old']]));
	});

	test('Edit description cannot be saved with an empty title', async () => {
		renderHistory([mine]);
		const user = await expandRow('Mine');

		await user.click(screen.getByRole('button', { name: 'Edit Description' }));
		await user.clear(await screen.findByRole('textbox', { name: 'Title' }));

		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
	});

	test('Reverse appears only for shared checkpoints', async () => {
		renderHistory([mine, theirs]);

		await expandRow('Theirs');
		expect(screen.getByRole('button', { name: 'Reverse This Checkpoint' })).toBeInTheDocument();
		await expandRow('Theirs');
		await expandRow('Mine');

		expect(screen.queryByRole('button', { name: 'Reverse This Checkpoint' })).not.toBeInTheDocument();
	});

	test('Reverse explains the new checkpoint and runs only after confirmation', async () => {
		renderHistory([theirs]);
		const user = await expandRow('Theirs');

		await user.click(screen.getByRole('button', { name: 'Reverse This Checkpoint' }));
		expect(await screen.findByText(/creates a new checkpoint that makes the opposite change/)).toBeInTheDocument();
		expect(engine.callsOf('reverseCheckpoint')).toEqual([]);
		await user.click(screen.getByRole('button', { name: 'Reverse' }));

		await vi.waitFor(() => expect(engine.callsOf('reverseCheckpoint')).toEqual([['c2']]));
	});

	test('Reverse rewrites files, so it asks to save every unsaved file first', async () => {
		dirty = [stubInterface<IWorkingCopy>({ resource: URI.file('/work/dose-model/a.R'), capabilities: WorkingCopyCapabilities.None, save: async () => true })];
		renderHistory([theirs]);
		const user = await expandRow('Theirs');

		await user.click(screen.getByRole('button', { name: 'Reverse This Checkpoint' }));
		await user.click(await screen.findByRole('button', { name: 'Reverse' }));

		await vi.waitFor(() => expect(engine.callsOf('reverseCheckpoint')).toEqual([['c2']]));
		expect(promptButtons).toEqual([['Save all and continue']]);
	});

	test('Go back asks to save unsaved files first', async () => {
		dirty = [stubInterface<IWorkingCopy>({ resource: URI.file('/work/dose-model/a.R'), capabilities: WorkingCopyCapabilities.None, save: async () => true })];
		renderHistory([theirs]);
		const user = await expandRow('Theirs');

		await user.click(screen.getByRole('button', { name: 'Go Back to This Checkpoint' }));

		await vi.waitFor(() => expect(engine.callsOf('goBackTo')).toEqual([['c2', []]]));
		expect(prompts).toEqual(['1 file in this project has unsaved edits.']);
	});

	test('a checkpoint with partialFiles shows the partial note', async () => {
		renderHistory([fakeCheckpoint({ id: 'c4', title: 'Part', partialFiles: ['dose.R', 'plot.R'] })]);

		await expandRow('Part');

		expect(screen.getByText('Contains part of the changes to dose.R, plot.R')).toBeInTheDocument();
	});

	test('shows the description of an expanded checkpoint and the git details on request', async () => {
		engine.state = fakeEngineState({ branch: 'main' });
		renderHistory([fakeCheckpoint({ id: 'abc123', title: 'Described', body: 'Fixed the axis' })]);
		const user = await expandRow('Described');

		expect(screen.getByText('Fixed the axis')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Show git details' }));

		const details = screen.getByLabelText('Git details');
		expect(details).toHaveTextContent(/^Commit idabc123Branchmain$/);
	});

	test('a title with a git word is shown as a neutral sentence, and the original only in the git details', async () => {
		renderHistory([fakeCheckpoint({ id: 'abc123', title: 'Merge pull request #12 from x/branch', authorName: 'Maya', authorIsMe: false, shared: true })]);
		const user = await expandRow('Combined work from Maya');

		expect(screen.queryByText(/Merge pull request/)).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Reverse This Checkpoint' }));
		expect(await screen.findByText(/Reversing "Combined work from Maya"/)).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		await user.click(screen.getByRole('button', { name: 'Show git details' }));

		expect(screen.getByLabelText('Git details')).toHaveTextContent('Merge pull request #12 from x/branch');
	});

	test('git details show the name of the shared copy when the engine reports it', async () => {
		const state = fakeEngineState({ branch: 'main' });
		Object.assign(state.shared, { name: 'origin/main' });
		engine.state = state;
		renderHistory([fakeCheckpoint({ id: 'abc123', title: 'Described' })]);
		const user = await expandRow('Described');

		await user.click(screen.getByRole('button', { name: 'Show git details' }));

		expect(screen.getByLabelText('Git details')).toHaveTextContent('Upstreamorigin/main');
	});

	test('loads the next page when the first page is full', async () => {
		const all = Array.from({ length: 60 }, (_, index) => fakeCheckpoint({ id: `c${index}`, title: `Checkpoint ${index}` }));
		renderHistory(all);
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Show older checkpoints' }));

		expect(await screen.findByText('Checkpoint 59')).toBeInTheDocument();
		expect(engine.callsOf('getHistory').at(-1)).toEqual([50, 50]);
		expect(screen.queryByRole('button', { name: 'Show older checkpoints' })).not.toBeInTheDocument();
	});

	const manyCheckpoints = (count: number) => Array.from({ length: count }, (_, index) => fakeCheckpoint({ id: `c${index}`, title: `Checkpoint ${index}` }));

	/** Makes the next `getHistory` call wait. The returned function answers it with the given page. */
	function holdNextPage(): (page: ICheckpoint[]) => void {
		const original = engine.getHistory.bind(engine);
		let release!: (page: ICheckpoint[]) => void;
		const held = new Promise<ICheckpoint[]>(resolve => { release = resolve; });
		let first = true;
		engine.getHistory = (skip, limit) => {
			if (first && skip > 0) {
				first = false;
				return held;
			}
			return original(skip, limit);
		};
		return release;
	}

	test('a refresh that arrives while a page loads leaves no duplicate and no missing row', async () => {
		const all = manyCheckpoints(60);
		renderHistory(all);
		const user = userEvent.setup();
		expect(await screen.findByText('Checkpoint 49')).toBeInTheDocument();
		const release = holdNextPage();

		await user.click(screen.getByRole('button', { name: 'Show older checkpoints' }));
		// A new checkpoint arrives, so every row moves down by one.
		const added = fakeCheckpoint({ id: 'new', title: 'Newest' });
		engine.history = [added, ...all];
		await act(async () => engine.fireChange());
		expect(await screen.findByText('Newest')).toBeInTheDocument();
		// The page that was asked for before the refresh arrives now, with the old offsets.
		await act(async () => release(all.slice(50)));

		expect(screen.queryByText('Checkpoint 59')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Show older checkpoints' }));
		expect(await screen.findByText('Checkpoint 59')).toBeInTheDocument();
		const titles = screen.getAllByRole('listitem').map(row => within(row).getAllByRole('button')[0].textContent);
		expect(titles).toEqual(engine.history.map(checkpoint => checkpoint.title));
		expect(engine.callsOf('getHistory').at(-1)).toEqual([50, 50]);
	});

	test('a refresh that leaves the first page unchanged keeps the older pages', async () => {
		renderHistory(manyCheckpoints(60));
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Show older checkpoints' }));
		expect(await screen.findByText('Checkpoint 59')).toBeInTheDocument();

		engine.history = manyCheckpoints(60);
		await act(async () => engine.fireChange());
		await vi.waitFor(() => expect(engine.callsOf('getChanges').length).toBeGreaterThan(1));

		expect(screen.getByText('Checkpoint 59')).toBeInTheDocument();
		expect(screen.getAllByRole('listitem')).toHaveLength(60);
	});

	test('a page that cannot be read says so and keeps Show older checkpoints available', async () => {
		renderHistory(manyCheckpoints(60));
		const user = userEvent.setup();
		expect(await screen.findByText('Checkpoint 49')).toBeInTheDocument();
		const original = engine.getHistory.bind(engine);
		engine.getHistory = async (skip, limit) => {
			if (skip > 0) {
				throw new Error('git did not answer');
			}
			return original(skip, limit);
		};

		await user.click(screen.getByRole('button', { name: 'Show older checkpoints' }));

		expect(await screen.findByText('That action could not finish. Your project is as it was.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Show older checkpoints' })).toBeInTheDocument();
		expect(screen.getAllByRole('listitem')).toHaveLength(50);
	});

	describe('plain descriptions of colleagues\' checkpoints', () => {
		let agent: FakeCheckpointsAgentService;
		/** The answers to hold, by checkpoint id; a held answer waits until the test releases it. */
		let held: Map<string, (outcome: JobOutcome<IHistoryDescription>) => void>;
		let holdAnswers: boolean;

		const plain = (id: string): JobOutcome<IHistoryDescription> => ({ ok: true, value: { title: `Plain ${id}`, summary: `Summary of ${id}.` }, fromCache: false });
		const colleague = (id: string, overrides: Partial<ICheckpoint> = {}) => fakeCheckpoint({ id, title: `raw ${id}`, body: `body of ${id}`, authorName: 'Maya', authorIsMe: false, ...overrides });

		beforeEach(() => {
			agent = ctx.disposables.add(new FakeCheckpointsAgentService(true));
			ctx.instantiationService.stub(ICheckpointsAgentService, agent);
			held = new Map();
			holdAnswers = false;
			agent.answers.set('describe-history', async input => {
				const { checkpoint } = input as { checkpoint: ICheckpoint };
				if (!holdAnswers) {
					return plain(checkpoint.id);
				}
				return new Promise<JobOutcome<IHistoryDescription>>(resolve => held.set(checkpoint.id, resolve));
			});
		});

		/** The ids of the checkpoints the agent was asked to describe, in order. */
		function describedIds(): string[] {
			return agent.runsOf('describe-history').map(run => (run.input as { checkpoint: ICheckpoint }).checkpoint.id);
		}

		test('runs only for colleagues\' checkpoints', async () => {
			renderHistory([mine, colleague('c2'), colleague('c3')]);

			expect(await screen.findByText('Plain c3')).toBeInTheDocument();
			expect(screen.getByText('Plain c2')).toBeInTheDocument();
			expect(screen.getByText('Mine')).toBeInTheDocument();
			expect(describedIds()).toEqual(['c2', 'c3']);
			expect(agent.runsOf('describe-history')[0].input).toEqual({ checkpoint: colleague('c2'), diff: '' });
		});

		test('runs for visible rows only, 3 at a time', async () => {
			holdAnswers = true;
			renderHistory(['c1', 'c2', 'c3', 'c4', 'c5'].map(id => colleague(id)));

			await vi.waitFor(() => expect(describedIds()).toEqual(['c1', 'c2', 'c3']));
			await act(async () => held.get('c2')!(plain('c2')));
			await vi.waitFor(() => expect(describedIds()).toEqual(['c1', 'c2', 'c3', 'c4']));
			expect(screen.getByText('Plain c2')).toBeInTheDocument();
			expect(screen.getByText('raw c1')).toBeInTheDocument();
		});

		test('rows of pages that are not loaded are not described until their page loads', async () => {
			renderHistory(Array.from({ length: 52 }, (_, index) => colleague(`c${index}`)));
			const user = userEvent.setup();

			await vi.waitFor(() => expect(describedIds()).toHaveLength(50));
			expect(describedIds()).toEqual(Array.from({ length: 50 }, (_, index) => `c${index}`));
			await user.click(screen.getByRole('button', { name: 'Show older checkpoints' }));

			expect(await screen.findByText('Plain c51')).toBeInTheDocument();
			expect(describedIds().slice(50)).toEqual(['c50', 'c51']);
		});

		test('the same rows loaded again make no new request', async () => {
			renderHistory([colleague('c2')]);
			expect(await screen.findByText('Plain c2')).toBeInTheDocument();

			engine.history = [colleague('c2')];
			await act(async () => engine.fireChange());
			await vi.waitFor(() => expect(engine.callsOf('getHistory').length).toBeGreaterThan(1));

			expect(describedIds()).toEqual(['c2']);
			expect(screen.getByText('Plain c2')).toBeInTheDocument();
		});

		test('the original message stays available under Show git details', async () => {
			renderHistory([colleague('c2')]);
			const user = await expandRow('Plain c2');

			expect(screen.getByText('Summary of c2.')).toBeInTheDocument();
			expect(screen.queryByText('body of c2')).not.toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'Show git details' }));

			expect(screen.getByLabelText('Git details')).toHaveTextContent('Description from gitraw c2 body of c2');
		});

		test('a failed job shows the original title', async () => {
			agent.answers.set('describe-history', { ok: false, reason: 'failed-check', detail: 'rejected' });
			renderHistory([colleague('c2')]);

			await vi.waitFor(() => expect(describedIds()).toEqual(['c2']));
			const user = await expandRow('raw c2');
			expect(screen.getByText('body of c2')).toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'Show git details' }));
			expect(screen.getByLabelText('Git details')).not.toHaveTextContent('Description from git');
		});

		test('nothing is described while the agent is not available, and the original titles return when it turns off', async () => {
			agent.setAvailable(false);
			renderHistory([colleague('c2')]);

			expect(await screen.findByText('raw c2')).toBeInTheDocument();
			expect(describedIds()).toEqual([]);

			await act(async () => agent.setAvailable(true));
			expect(await screen.findByText('Plain c2')).toBeInTheDocument();

			await act(async () => agent.setAvailable(false));
			expect(screen.getByText('raw c2')).toBeInTheDocument();
			expect(describedIds()).toEqual(['c2']);
		});

		test('nothing is described while the view is hidden', async () => {
			const visibility = ctx.disposables.add(new Emitter<boolean>());
			const container = stubInterface<IReactComponentContainer>({ containerVisible: false, onVisibilityChanged: visibility.event });
			engine.history = [colleague('c2')];
			rtl.render(<CheckpointsPanel container={container} />);

			expect(await screen.findByText('raw c2')).toBeInTheDocument();
			expect(describedIds()).toEqual([]);

			await act(async () => visibility.fire(true));
			expect(await screen.findByText('Plain c2')).toBeInTheDocument();
		});

		test('a request that is in progress when the view closes is cancelled', async () => {
			holdAnswers = true;
			const { unmount } = rtl.render(<CheckpointsPanel />);
			engine.history = [colleague('c2')];
			await act(async () => engine.fireChange());
			await vi.waitFor(() => expect(describedIds()).toEqual(['c2']));

			unmount();

			expect(agent.runsOf('describe-history')[0].token.isCancellationRequested).toBe(true);
		});
	});

	test('with no checkpoints the section says so', async () => {
		renderHistory([]);

		expect(await screen.findByText(/No checkpoints yet/)).toBeInTheDocument();
	});
});

describe('GitDetails', () => {
	test('leaves out the upstream when there is none', () => {
		const { container } = render(<GitDetails branch='main' commitId='abc' />);

		expect(container).toHaveTextContent(/^Commit idabcBranchmain$/);
	});
});
