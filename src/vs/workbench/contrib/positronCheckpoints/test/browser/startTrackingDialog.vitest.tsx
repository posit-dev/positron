/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { Event } from '../../../../../base/common/event.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { isUsableEmail } from '../../browser/components/startTrackingDialog.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { fakeCheckpoint, FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

describe('StartTrackingDialog', () => {
	const ctx = createTestContainer()
		.withReactServices()
		// The disclosure card of the panel reads the agent service; no job waits on it here.
		.stub(ICheckpointsAgentService, { pendingDisclosure: false, onDidChangePendingDisclosure: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let engine: FakeCheckpointsEngine;

	beforeEach(() => {
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const cancel = screen.queryByRole('button', { name: 'Cancel' });
		if (cancel) {
			await userEvent.click(cancel);
		}
	});

	async function openDialog() {
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Start keeping checkpoints' }));
		const dialog = await screen.findByRole('dialog');
		return { user, dialog };
	}

	test('identity fields appear only when identity is missing', async () => {
		const { dialog } = await openDialog();

		expect(within(dialog).queryByRole('textbox', { name: 'Your name' })).not.toBeInTheDocument();
		expect(within(dialog).queryByRole('textbox', { name: 'Your email address' })).not.toBeInTheDocument();
		expect(within(dialog).queryByText('Checkpoints records who made each one.')).not.toBeInTheDocument();
	});

	test('identity fields explain why they are needed, and the email needs an @', async () => {
		engine.state = fakeEngineState({ tracking: 'not-a-project', identityMissing: true });
		const { user, dialog } = await openDialog();

		expect(within(dialog).getByText('Checkpoints records who made each one.')).toBeInTheDocument();
		const start = within(dialog).getByRole('button', { name: 'Start' });
		expect(start).toBeDisabled();

		await user.type(within(dialog).getByRole('textbox', { name: 'Your name' }), 'Maya Ortiz');
		await user.type(within(dialog).getByRole('textbox', { name: 'Your email address' }), 'maya.example.org');
		expect(await within(dialog).findByText('Enter an email address that contains @.')).toBeInTheDocument();
		expect(start).toBeDisabled();

		await user.type(within(dialog).getByRole('textbox', { name: 'Your email address' }), '{Backspace>16}maya@example.org');
		expect(start).toBeEnabled();
		await user.click(start);

		await vi.waitFor(() => expect(engine.callsOf('startTracking')).toEqual([
			[{ name: 'Maya Ortiz', email: 'maya@example.org' }, '.Rhistory\n'],
		]));
	});

	test('an identity-missing answer from the engine shows the fields and keeps the dialog open', async () => {
		engine.nextResult = { kind: 'unavailable', reason: 'nothing-to-do', detail: 'identity-missing' };
		const { user, dialog } = await openDialog();
		expect(within(dialog).queryByRole('textbox', { name: 'Your name' })).not.toBeInTheDocument();

		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		expect(await within(dialog).findByRole('textbox', { name: 'Your name' })).toBeInTheDocument();
		expect(within(dialog).getByText('Checkpoints records who made each one.')).toBeInTheDocument();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Start' })).toBeDisabled();
	});

	test('the dialog never names the ignore file and proposes the list in an editable box', async () => {
		const { user, dialog } = await openDialog();

		expect(dialog).not.toHaveTextContent(/gitignore/i);
		expect(within(dialog).getByRole('checkbox', { name: 'Leave these files out of checkpoints' })).toBeChecked();
		const box = await within(dialog).findByRole('textbox', { name: 'Files and folders to leave out, one per line' });
		expect(box).toHaveValue('.Rhistory\n');

		await user.type(box, '*.tmp');
		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		await vi.waitFor(() => expect(engine.callsOf('startTracking')).toEqual([[undefined, '.Rhistory\n*.tmp']]));
	});

	test('unticking the ignore list passes no gitignore', async () => {
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('checkbox', { name: 'Leave these files out of checkpoints' }));
		expect(within(dialog).getByRole('textbox', { name: 'Files and folders to leave out, one per line' })).toBeDisabled();
		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		await vi.waitFor(() => expect(engine.callsOf('startTracking')).toEqual([[undefined, undefined]]));
	});

	test('after starting, the view shows one checkpoint', async () => {
		const original = engine.startTracking.bind(engine);
		engine.startTracking = async (identity, gitignore) => {
			const result = await original(identity, gitignore);
			engine.state = fakeEngineState({ shared: { exists: false, ahead: 0, behind: 0 } });
			engine.history = [fakeCheckpoint({ id: 'first', title: 'Start of the dose model' })];
			engine.fireChange();
			return result;
		};
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Start' }));

		expect(await screen.findByText('Start of the dose model')).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Start keeping checkpoints' })).not.toBeInTheDocument();
	});

	test('Cancel changes nothing', async () => {
		const { user, dialog } = await openDialog();

		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(engine.callsOf('startTracking')).toEqual([]);
	});

	test('an email needs text on both sides of an @', () => {
		expect(['a@b', 'a@b.org', ' a@b ', '@b', 'a@', 'ab', ''].map(isUsableEmail)).toEqual([true, true, true, false, false, false, false]);
	});
});
