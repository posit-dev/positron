/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { NotebookContextKeys } from '../../../common/notebookContextKeys.js';
import { INotebookContextDTO } from '../../../../../common/positron/notebookAssistant.js';
import { IHeadlessLanguageModelService } from '../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { AssistantPanelActions } from '../../../browser/AssistantPanel/AssistantPanelActions.js';

const { mockGenerateNotebookSuggestions } = vi.hoisted(() => ({
	mockGenerateNotebookSuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../browser/AssistantPanel/notebookSuggestions.js', () => ({
	generateNotebookSuggestions: mockGenerateNotebookSuggestions,
}));

describe('AssistantPanelActions AI gate', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	let configurationService: TestConfigurationService;
	let contextKeyService: IContextKeyService;
	let notificationService: INotificationService;

	beforeEach(() => {
		configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		contextKeyService = ctx.get(IContextKeyService);
		notificationService = stubInterface<INotificationService>({ info: vi.fn(), error: vi.fn() });
		mockGenerateNotebookSuggestions.mockReset().mockResolvedValue([]);
		// Default the composite notebook AI gate on (matching the default) and
		// nothing excluded.
		contextKeyService.createKey(NotebookContextKeys.aiEnabled.key, true);
		configurationService.setUserConfiguration('positron.assistant.aiExcludes', []);
	});

	function renderActions() {
		const notebookContext: INotebookContextDTO = {
			uri: 'file:///n.ipynb',
			kernelLanguage: 'python',
			cellCount: 0,
			selectedCells: [],
			allCells: [],
		};
		rtl.render(
			<AssistantPanelActions
				configurationService={configurationService}
				headlessLmService={stubInterface<IHeadlessLanguageModelService>({})}
				notebook={stubInterface<IPositronNotebookInstance>({ uri: URI.parse('file:///n.ipynb') })}
				notebookContext={notebookContext}
				notificationService={notificationService}
				onActionSelected={vi.fn()}
				onClose={vi.fn()}
			/>
		);
	}

	async function clickGenerate() {
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: /Generate AI Suggestions/ }));
	}

	it('requests suggestions when AI is enabled', async () => {
		renderActions();
		await clickGenerate();
		await waitFor(() => expect(mockGenerateNotebookSuggestions).toHaveBeenCalledTimes(1));
	});

	it('does not request suggestions when the notebook AI gate is off, and notifies instead', async () => {
		// The composite notebook AI gate (ai.enabled AND notebook.ai.enabled, whose
		// composition is covered in notebookAIEnabledContextKey.vitest.ts) gates
		// suggestion generation.
		contextKeyService.createKey(NotebookContextKeys.aiEnabled.key, false);
		renderActions();
		await clickGenerate();
		expect(mockGenerateNotebookSuggestions).not.toHaveBeenCalled();
		expect(notificationService.info).toHaveBeenCalledTimes(1);
	});

	it('stops generating and notifies when the model stalls past the timeout', async () => {
		vi.useFakeTimers();
		try {
			// Simulate a stalling model: the generator resolves with nothing only
			// once its request token is cancelled, mirroring the parser returning
			// what it has when the timeout fires.
			mockGenerateNotebookSuggestions.mockImplementation(
				(_service, _context, _model, token: CancellationToken) =>
					new Promise(resolve => {
						const listener = token.onCancellationRequested(() => {
							listener.dispose();
							resolve([]);
						});
					})
			);
			renderActions();
			// fireEvent (not userEvent) because userEvent's internal timers do not
			// advance cleanly under vi.useFakeTimers(), which this test needs to
			// cross the generation timeout without a 30s real-time wait.
			// eslint-disable-next-line testing-library/prefer-user-event -- fake timers
			fireEvent.click(screen.getByRole('button', { name: /Generate AI Suggestions/ }));

			// Cross the 30s generation cap; the timeout cancels the stalled request.
			await vi.advanceTimersByTimeAsync(60_000);

			expect(notificationService.info).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
