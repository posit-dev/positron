/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IHeadlessLanguageModelService, StreamTextResult } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { CheckpointsAgentService, ICheckpointsAgentService } from '../../browser/checkpointsAgentService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { CheckpointsPanel } from '../../browser/components/checkpointsPanel.js';
import { ISyncController, SyncController } from '../../browser/syncController.js';
import { CHECKPOINTS_SUGGESTIONS_ENABLED_KEY } from '../../common/checkpointsConfiguration.js';
import { Job } from '../../common/agent/jobTypes.js';
import { FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

const titleJob: Job<string, string> = {
	name: 'title',
	weight: 'light',
	version: 1,
	buildPrompt: input => ({ systemPrompt: 'Write a title.', user: input }),
	check: raw => typeof (raw as { title?: unknown }).title === 'string' ? (raw as { title: string }).title : undefined,
};

describe('DisclosureCard', () => {
	const openSettings = vi.fn(async () => undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPreferencesService, { openSettings })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let configuration: TestConfigurationService;
	let agentService: CheckpointsAgentService;
	let engine: FakeCheckpointsEngine;
	const streamText = vi.fn(async (): Promise<StreamTextResult> => ({
		available: true,
		model: { id: 'model-1', name: 'Model 1' },
		usedFallback: false,
		text: (async function* () {
			yield '{"title": "Fixed the dose units"}';
		})(),
	}));

	beforeEach(() => {
		openSettings.mockClear();
		streamText.mockClear();
		configuration = new TestConfigurationService({ [AI_ENABLED_KEY]: true, [CHECKPOINTS_SUGGESTIONS_ENABLED_KEY]: true });
		agentService = ctx.disposables.add(new CheckpointsAgentService(
			configuration,
			ctx.disposables.add(new InMemoryStorageService()),
			stubInterface<IHeadlessLanguageModelService>({ streamText }),
			new NullLogService(),
		));
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, ctx.disposables.add(new CheckpointsMessageService()));
		ctx.instantiationService.stub(ISyncController, ctx.disposables.add(ctx.instantiationService.createInstance(SyncController)));
		ctx.instantiationService.stub(ICheckpointsAgentService, agentService);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
	});

	test('the notice shows in a folder that is not keeping checkpoints', async () => {
		engine.state = fakeEngineState({ tracking: 'not-a-project' });
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByRole('button', { name: 'Start keeping checkpoints' })).toBeInTheDocument();

		void agentService.run(titleJob, 'diff', CancellationToken.None);

		expect(await screen.findByRole('region', { name: 'Descriptions of your changes' })).toBeInTheDocument();
	});

	test('the notice shows only while a job waits for it, and OK lets the job continue', async () => {
		rtl.render(<CheckpointsPanel />);
		expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
		expect(screen.queryByRole('region', { name: 'Descriptions of your changes' })).not.toBeInTheDocument();
		const user = userEvent.setup();

		const outcome = agentService.run(titleJob, 'diff', CancellationToken.None);
		const card = await screen.findByRole('region', { name: 'Descriptions of your changes' });
		expect(within(card).getByText('Checkpoints sends your changes to your configured model provider to describe them.')).toBeInTheDocument();
		expect(streamText).not.toHaveBeenCalled();

		await user.click(within(card).getByRole('button', { name: 'OK' }));

		expect(await outcome).toEqual({ ok: true, value: 'Fixed the dose units', fromCache: false });
		expect(screen.queryByRole('region', { name: 'Descriptions of your changes' })).not.toBeInTheDocument();
	});

	test('Turn off suggestions turns the setting off and the job ends without a model call', async () => {
		const updateValue = vi.spyOn(configuration, 'updateValue');
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		const outcome = agentService.run(titleJob, 'diff', CancellationToken.None);
		const card = await screen.findByRole('region', { name: 'Descriptions of your changes' });
		await user.click(within(card).getByRole('button', { name: 'Turn off suggestions' }));

		expect(await outcome).toEqual({ ok: false, reason: 'suggestions-off' });
		expect(updateValue).toHaveBeenCalledWith(CHECKPOINTS_SUGGESTIONS_ENABLED_KEY, false);
		expect(streamText).not.toHaveBeenCalled();
	});

	test('the notice links to the setting', async () => {
		rtl.render(<CheckpointsPanel />);
		const user = userEvent.setup();

		void agentService.run(titleJob, 'diff', CancellationToken.None);
		const card = await screen.findByRole('region', { name: 'Descriptions of your changes' });
		await user.click(within(card).getByRole('button', { name: 'Open the setting' }));

		expect(openSettings).toHaveBeenCalledWith({ query: CHECKPOINTS_SUGGESTIONS_ENABLED_KEY });
	});
});
