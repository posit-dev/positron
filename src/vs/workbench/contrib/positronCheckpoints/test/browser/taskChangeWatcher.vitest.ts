/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IModelContentChangedEvent } from '../../../../../editor/common/textModelEvents.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { IChangedFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IHeadlessLanguageModelService, IStreamTextRequest, StreamTextResult } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { ITextFileEditorModelManager, ITextFileSaveEvent, ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { CheckpointsAgentService, ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { EDIT_DEBOUNCE_MS, TaskChangeWatcher } from '../../browser/taskChangeWatcher.js';
import { IChunkProposal, IProposedChunk } from '../../common/agent/splitIntoChunks.js';
import { CHECKPOINTS_MODEL_KEY, CHECKPOINTS_SUGGESTIONS_ENABLED_KEY } from '../../common/checkpointsConfiguration.js';
import { FakeCheckpointsAgentService } from './fakeAgentService.js';
import { fakeCheckpoint, FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

const ROOT = '/work/dose-model';

/** A changed text file with one part of `lines` added lines. */
function changedFile(path: string, lines = 3): IChangedFile {
	return {
		path, status: 'modified', binary: false, sizeBytes: 100, tooLarge: false,
		hunks: [{ id: `${path}#1`, header: '@@ -1 +1 @@', addedLines: lines, removedLines: 0, patch: '+x\n' }],
	};
}

function chunk(overrides: Partial<IProposedChunk> = {}): IProposedChunk {
	return { title: 'Fixed the dose-response plot', summary: 'You fixed the axis labels.', hunkIds: ['plot_dose.R#1'], wholeFiles: [], finished: true, ...overrides };
}

function proposal(...chunks: IProposedChunk[]): { ok: true; value: IChunkProposal; fromCache: false } {
	return { ok: true, value: { chunks }, fromCache: false };
}

describe('TaskChangeWatcher', () => {
	const disposables = new DisposableStore();
	let engine: FakeCheckpointsEngine;
	let checkpointsService: CheckpointsService;
	let suggestions: CheckpointsSuggestionService;
	let saves: Emitter<ITextFileSaveEvent>;
	let modelAdded: Emitter<ITextModel>;

	beforeEach(() => {
		engine = disposables.add(new FakeCheckpointsEngine());
		engine.changes = { basis: 'basis-1', files: [changedFile('plot_dose.R')] };
		checkpointsService = disposables.add(new CheckpointsService(new NullLogService()));
		disposables.add(checkpointsService.registerEngine(engine));
		suggestions = disposables.add(new CheckpointsSuggestionService());
		saves = disposables.add(new Emitter<ITextFileSaveEvent>());
		modelAdded = disposables.add(new Emitter<ITextModel>());
	});

	afterEach(() => {
		vi.useRealTimers();
		disposables.clear();
	});

	/** Creates the watcher and waits until it has read the changes. */
	async function createWatcher(agentService: ICheckpointsAgentService): Promise<TaskChangeWatcher> {
		const watcher = disposables.add(new TaskChangeWatcher(
			checkpointsService,
			agentService,
			suggestions,
			stubInterface<ITextFileService>({ files: stubInterface<ITextFileEditorModelManager>({ onDidSave: saves.event }) }),
			stubInterface<IModelService>({ getModels: () => [], onModelAdded: modelAdded.event, onModelRemoved: disposables.add(new Emitter<ITextModel>()).event }),
			stubInterface<IWorkspaceContextService>({ getWorkspace: () => stubInterface<IWorkspace>({ folders: [] }) }),
			stubInterface<IUriIdentityService>({ extUri }),
			new NullLogService(),
		));
		await vi.waitFor(() => expect(engine.callsOf('getChanges').length).toBeGreaterThan(0));
		// The change set is applied after the engine answers.
		await new Promise(resolve => setTimeout(resolve, 0));
		return watcher;
	}

	function save(path: string): void {
		saves.fire(stubInterface<ITextFileSaveEvent>({ model: stubInterface<ITextFileSaveEvent['model']>({ resource: URI.file(`${ROOT}/${path}`) }) }));
	}

	/** Saves a file inside the set of changed files, then one outside it: a signal. */
	function moveToNewTask(): void {
		save('plot_dose.R');
		save('import_march.R');
	}

	test('an edit outside the set after one inside it publishes a suggestion', async () => {
		const agent = disposables.add(new FakeCheckpointsAgentService());
		agent.answers.set('split-into-chunks', proposal(chunk(), chunk({ title: 'Started the import script', hunkIds: [], wholeFiles: ['import_march.R'], finished: false })));
		await createWatcher(agent);

		moveToNewTask();

		await vi.waitFor(() => expect(suggestions.current?.chunks.map(c => c.title)).toEqual(['Fixed the dose-response plot', 'Started the import script']));
		expect(agent.runsOf('split-into-chunks').map(run => run.input)).toEqual([engine.changes]);
	});

	test('watcher shows no card when no chunk is finished', async () => {
		const agent = disposables.add(new FakeCheckpointsAgentService());
		agent.answers.set('split-into-chunks', proposal(chunk({ finished: false })));
		await createWatcher(agent);

		moveToNewTask();

		await vi.waitFor(() => expect(agent.runsOf('split-into-chunks')).toHaveLength(1));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(suggestions.current).toBeUndefined();
	});

	test('watcher makes no model call when ai.enabled is false', async () => {
		const streamText = vi.fn(async (_request: IStreamTextRequest): Promise<StreamTextResult> => ({ available: false, reason: 'no-providers-configured' }));
		const configuration = new TestConfigurationService({ [AI_ENABLED_KEY]: false, [CHECKPOINTS_SUGGESTIONS_ENABLED_KEY]: true, [CHECKPOINTS_MODEL_KEY]: [] });
		const storage = disposables.add(new InMemoryStorageService());
		storage.store(CheckpointsAgentService.DISCLOSED_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const agent = disposables.add(new CheckpointsAgentService(configuration, storage, stubInterface<IHeadlessLanguageModelService>({ streamText }), new NullLogService()));
		const run = vi.spyOn(agent, 'run');
		// Over the size limit too, so every kind of signal is present.
		engine.changes = { basis: 'basis-1', files: [changedFile('plot_dose.R', 400)] };
		await createWatcher(agent);

		moveToNewTask();
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(run).not.toHaveBeenCalled();
		expect(streamText).not.toHaveBeenCalled();
		expect(suggestions.current).toBeUndefined();
	});

	test('typing in a project file counts as an edit after a pause of 2 seconds; typing elsewhere does not', async () => {
		const agent = disposables.add(new FakeCheckpointsAgentService());
		agent.answers.set('split-into-chunks', proposal(chunk()));
		await createWatcher(agent);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

		/** Adds an open model for `uri` and returns a function that types in it. */
		const open = (uri: URI) => {
			const changes = disposables.add(new Emitter<IModelContentChangedEvent>());
			modelAdded.fire(stubInterface<ITextModel>({ uri, onDidChangeContent: changes.event }));
			return () => changes.fire(stubInterface<IModelContentChangedEvent>({}));
		};
		const typeInPlot = open(URI.file(`${ROOT}/plot_dose.R`));
		const typeInImport = open(URI.file(`${ROOT}/import_march.R`));
		const typeElsewhere = open(URI.file('/elsewhere/notes.R'));
		const typeUntitled = open(URI.from({ scheme: 'untitled', path: `${ROOT}/plot_dose.R` }));

		typeInPlot();
		vi.advanceTimersByTime(EDIT_DEBOUNCE_MS);
		typeElsewhere();
		typeUntitled();
		vi.advanceTimersByTime(EDIT_DEBOUNCE_MS);
		expect(agent.runsOf('split-into-chunks')).toHaveLength(0);

		typeInImport();
		vi.advanceTimersByTime(EDIT_DEBOUNCE_MS - 1);
		// More typing restarts the wait.
		typeInImport();
		vi.advanceTimersByTime(EDIT_DEBOUNCE_MS - 1);
		expect(agent.runsOf('split-into-chunks')).toHaveLength(0);

		vi.advanceTimersByTime(1);
		expect(agent.runsOf('split-into-chunks')).toHaveLength(1);
	});

	test('a change set with another basis and a new checkpoint each close the suggestion', async () => {
		const agent = disposables.add(new FakeCheckpointsAgentService());
		agent.answers.set('split-into-chunks', proposal(chunk()));
		engine.history = [fakeCheckpoint({ id: 'c1' })];
		await createWatcher(agent);

		moveToNewTask();
		await vi.waitFor(() => expect(suggestions.current).toBeDefined());

		// The same basis keeps the suggestion.
		engine.fireChange();
		await vi.waitFor(() => expect(engine.callsOf('getChanges')).toHaveLength(2));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(suggestions.current).toBeDefined();

		engine.changes = { basis: 'basis-2', files: engine.changes.files };
		engine.fireChange();
		await vi.waitFor(() => expect(suggestions.current).toBeUndefined());

		suggestions.publish({ changes: engine.changes, chunks: [chunk()] });
		engine.history = [fakeCheckpoint({ id: 'c2' }), fakeCheckpoint({ id: 'c1' })];
		engine.fireChange();
		await vi.waitFor(() => expect(suggestions.current).toBeUndefined());
	});

	test('a dismissal makes the next suggestion wait twice as long', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const agent = disposables.add(new FakeCheckpointsAgentService());
		agent.answers.set('split-into-chunks', proposal(chunk()));
		await createWatcher(agent);
		moveToNewTask();
		await vi.waitFor(() => expect(suggestions.current).toBeDefined());

		suggestions.dismiss();
		// A changed basis lets a new suggestion through.
		engine.changes = { basis: 'basis-2', files: engine.changes.files };
		engine.fireChange();
		await vi.waitFor(() => expect(engine.callsOf('getChanges')).toHaveLength(2));
		await new Promise(resolve => setTimeout(resolve, 0));

		vi.setSystemTime(Date.now() + 15 * 60_000);
		moveToNewTask();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(agent.runsOf('split-into-chunks')).toHaveLength(1);

		vi.setSystemTime(Date.now() + 6 * 60_000);
		moveToNewTask();
		await vi.waitFor(() => expect(agent.runsOf('split-into-chunks')).toHaveLength(2));
	});

	test('a project that is no longer tracked closes the suggestion', async () => {
		const agent = disposables.add(new FakeCheckpointsAgentService());
		agent.answers.set('split-into-chunks', proposal(chunk()));
		await createWatcher(agent);
		moveToNewTask();
		await vi.waitFor(() => expect(suggestions.current).toBeDefined());

		engine.state = { ...engine.state, unusual: { kind: 'detached', detail: '' } };
		engine.fireChange();

		await vi.waitFor(() => expect(suggestions.current).toBeUndefined());
	});
});
