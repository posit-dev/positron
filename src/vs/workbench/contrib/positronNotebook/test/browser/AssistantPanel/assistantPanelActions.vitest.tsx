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
import { AI_ENABLED_KEY } from '../../../../positronAssistant/common/positronAIConfiguration.js';
import { IHeadlessLanguageModelService } from '../../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { AssistantPanelActions, AssistantPanelDocumentKind } from '../../../browser/AssistantPanel/AssistantPanelActions.js';

const { mockGenerateSuggestions } = vi.hoisted(() => ({
	mockGenerateSuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../browser/AssistantPanel/notebookSuggestions.js', () => ({
	generateSuggestions: mockGenerateSuggestions,
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
		mockGenerateSuggestions.mockReset().mockResolvedValue([]);
		// Default the composite notebook AI gate on (matching the default) and
		// nothing excluded.
		contextKeyService.createKey(NotebookContextKeys.aiEnabled.key, true);
		configurationService.setUserConfiguration('positron.assistant.aiExcludes', []);
	});

	function renderActions(kind: AssistantPanelDocumentKind = 'notebook') {
		rtl.render(
			<AssistantPanelActions
				configurationService={configurationService}
				headlessLmService={stubInterface<IHeadlessLanguageModelService>({})}
				kind={kind}
				notificationService={notificationService}
				suggestionsRequest={{ systemPrompt: '', context: '' }}
				uri={URI.parse('file:///n.ipynb')}
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
		await waitFor(() => expect(mockGenerateSuggestions).toHaveBeenCalledTimes(1));
	});

	it('does not request suggestions when the notebook AI gate is off, and notifies instead', async () => {
		// The composite notebook AI gate (ai.enabled AND notebook.ai.enabled, whose
		// composition is covered in notebookAIEnabledContextKey.vitest.ts) gates
		// suggestion generation.
		contextKeyService.createKey(NotebookContextKeys.aiEnabled.key, false);
		renderActions();
		await clickGenerate();
		expect(mockGenerateSuggestions).not.toHaveBeenCalled();
		expect(notificationService.info).toHaveBeenCalledTimes(1);
	});

	it('gates documents on ai.enabled rather than the notebook AI gate', async () => {
		// The notebook AI gate stays on; only ai.enabled is off.
		configurationService.setUserConfiguration(AI_ENABLED_KEY, false);
		renderActions('document');
		await clickGenerate();
		expect(mockGenerateSuggestions).not.toHaveBeenCalled();
		expect(notificationService.info).toHaveBeenCalledTimes(1);
	});

	it('stops generating and notifies when the model stalls past the timeout', async () => {
		vi.useFakeTimers();
		try {
			// Simulate a stalling model: the generator resolves with nothing only
			// once its request token is cancelled, mirroring the parser returning
			// what it has when the timeout fires.
			mockGenerateSuggestions.mockImplementation(
				(_service, _request, _model, token: CancellationToken) =>
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
