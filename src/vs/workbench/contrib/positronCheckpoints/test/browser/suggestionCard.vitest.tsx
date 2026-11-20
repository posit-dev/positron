/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IActivity, IActivityService, NumberBadge } from '../../../../services/activity/common/activity.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IChangedFile, IChangeSet, IHunk } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsSuggestionService, ICheckpointsSuggestionService } from '../../browser/checkpointsSuggestionService.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { CheckpointsSuggestionBadge, POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID } from '../../browser/positronCheckpoints.contribution.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { IProposalController } from '../../browser/proposalController.js';
import { createProposalController } from './proposalTestHelpers.js';
import { IProposedChunk } from '../../common/agent/splitIntoChunks.js';
import { FakeCheckpointsAgentService } from './fakeAgentService.js';
import { FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

function hunk(id: string): IHunk {
	return { id, header: '@@ -1 +1 @@', addedLines: 1, removedLines: 1, patch: `@@ -1 +1 @@\n-old ${id}\n+new ${id}\n` };
}

function changedFile(path: string, hunks: IHunk[]): IChangedFile {
	return { path, status: 'modified', binary: false, sizeBytes: 100, tooLarge: false, hunks };
}

const changes: IChangeSet = {
	basis: 'b1',
	files: [
		changedFile('plot_dose.R', [hunk('p1')]),
		changedFile('theme.R', [hunk('t1')]),
		changedFile('import_march.R', [hunk('i1')]),
	],
};

const chunks: IProposedChunk[] = [
	{ title: 'Fixed the dose-response plot', summary: 'You fixed the axis labels.', hunkIds: ['p1', 't1'], wholeFiles: [], finished: true },
	{ title: 'Started the import script', summary: 'You began an import script.', hunkIds: ['i1'], wholeFiles: [], finished: false },
];

describe('SuggestionCard', () => {
	const [notify, info, warn, error, prompt, status] = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];
	const notificationSpies = [notify, info, warn, error, prompt, status];
	const ctx = createTestContainer()
		.withReactServices()
		.stub(INotificationService, { notify, info, warn, error, prompt, status })
		.stub(IWorkingCopyService, {
			dirtyWorkingCopies: [],
			onDidRegister: new Emitter<IWorkingCopy>().event,
			onDidUnregister: new Emitter<IWorkingCopy>().event,
			onDidChangeDirty: new Emitter<IWorkingCopy>().event,
		})
		.stub(IUriIdentityService, { extUri })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.stub(IFileService, {})
		.stub(IEditorService, {})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;
	let suggestions: CheckpointsSuggestionService;
	/** The badges shown on the activity bar, and whether each is still shown. */
	let badges: { containerId: string; activity: IActivity; shown: boolean }[];

	beforeEach(() => {
		notificationSpies.forEach(spy => spy.mockClear());
		badges = [];
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		engine.changes = changes;
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.instantiationService.stub(IProposalController, createProposalController(ctx.instantiationService, ctx.disposables));
		ctx.instantiationService.stub(ICheckpointsAgentService, ctx.disposables.add(new FakeCheckpointsAgentService(false)));
		suggestions = ctx.disposables.add(new CheckpointsSuggestionService());
		ctx.instantiationService.stub(ICheckpointsSuggestionService, suggestions);
		ctx.disposables.add(checkpointsService.registerEngine(engine));

		const activityService = stubInterface<IActivityService>({
			showViewContainerActivity: (containerId, activity) => {
				const badge = { containerId, activity, shown: true };
				badges.push(badge);
				return toDisposable(() => { badge.shown = false; });
			},
		});
		ctx.disposables.add(new CheckpointsSuggestionBadge(suggestions, activityService));
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const dialog = screen.queryByRole('dialog');
		if (dialog) {
			await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		}
	});

	async function renderWithSuggestion() {
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
		act(() => suggestions.publish({ changes, chunks }));
		return screen.findByRole('region', { name: 'Suggested versions' });
	}

	test('the card sets a badge and never calls the notification service', async () => {
		const card = await renderWithSuggestion();

		expect(within(card).getByText('This looks like a good place to save a version.')).toBeInTheDocument();
		expect(badges).toHaveLength(1);
		expect(badges[0].containerId).toBe(POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID);
		expect(badges[0].shown).toBe(true);
		expect(badges[0].activity.badge).toBeInstanceOf(NumberBadge);
		expect((badges[0].activity.badge as NumberBadge).number).toBe(1);

		await userEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));

		expect(screen.queryByRole('region', { name: 'Suggested versions' })).not.toBeInTheDocument();
		expect(badges[0].shown).toBe(false);
		expect(suggestions.current).toBeUndefined();
		for (const spy of notificationSpies) {
			expect(spy).not.toHaveBeenCalled();
		}
	});

	test('the card lists the chunks with the finished ones ticked and their file counts', async () => {
		const card = await renderWithSuggestion();

		const rows = within(card).getAllByRole('listitem');
		expect(rows.map(row => row.textContent)).toEqual(['Fixed the dose-response plot2 files', 'Started the import script1 file']);
		expect(within(card).getByRole('checkbox', { name: 'Fixed the dose-response plot' })).toBeChecked();
		expect(within(card).getByRole('checkbox', { name: 'Started the import script' })).not.toBeChecked();
		expect(within(card).getByRole('button', { name: 'Save a Version' })).toBeInTheDocument();

		await userEvent.click(within(card).getByRole('checkbox', { name: 'Started the import script' }));
		expect(within(card).getByRole('button', { name: 'Save 2 Versions' })).toBeInTheDocument();
	});

	test('Create opens the dialog with the chunks and creates nothing by itself', async () => {
		const card = await renderWithSuggestion();
		const user = userEvent.setup();

		await user.click(within(card).getByRole('button', { name: 'Save a Version' }));

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByDisplayValue('Fixed the dose-response plot')).toBeInTheDocument();
		expect(within(dialog).getByDisplayValue('Started the import script')).toBeInTheDocument();
		const groups = within(dialog).getAllByRole('group', { name: /^Version \d+$/ });
		expect(within(groups[0]).getByRole('checkbox', { name: 'Version 1' })).toBeChecked();
		expect(within(groups[1]).getByRole('checkbox', { name: 'Version 2' })).not.toBeChecked();
		expect(engine.callsOf('createCheckpoints')).toEqual([]);

		await user.click(within(dialog).getByRole('button', { name: 'Save a Version' }));

		await vi.waitFor(() => expect(engine.callsOf('createCheckpoints')).toEqual([
			// Every part of a file is sent as the whole file.
			['b1', [{ title: 'Fixed the dose-response plot', body: 'You fixed the axis labels.', hunkIds: [], wholeFiles: ['plot_dose.R', 'theme.R'] }]],
		]));
		await vi.waitFor(() => expect(suggestions.current).toBeUndefined());
	});

	test('Edit opens the dialog with the chunks', async () => {
		const card = await renderWithSuggestion();

		await userEvent.click(within(card).getByRole('button', { name: 'Edit' }));

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByDisplayValue('Started the import script')).toBeInTheDocument();
		expect(engine.callsOf('createCheckpoints')).toEqual([]);
	});
});
