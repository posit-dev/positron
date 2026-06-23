/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../../../base/common/event.js';
import { observableValue } from '../../../../../../../base/common/observable.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService, NullLogService } from '../../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { INotebookExecutionStateService } from '../../../../../notebook/common/notebookExecutionStateService.js';
import { NotebookTextModel } from '../../../../../notebook/common/model/notebookTextModel.js';
import { AI_ENABLED_KEY } from '../../../../../positronAssistant/common/positronAIConfiguration.js';
import { IPositronNotebookInstance } from '../../../IPositronNotebookInstance.js';
import { GhostCellController } from '../controller.js';

describe('GhostCellController ai.enabled gate', () => {
	const config = new TestConfigurationService();
	const ctx = createTestContainer()
		.stub(ICommandService, { executeCommand: () => Promise.resolve(undefined) })
		.stub(IConfigurationService, config)
		.stub(INotebookExecutionStateService, stubInterface<INotebookExecutionStateService>({ onDidChangeExecution: Event.None }))
		.stub(INotificationService, stubInterface<INotificationService>())
		.stub(ILogService, new NullLogService())
		.build();

	// The per-notebook override turns ghost cells ON, so `ai.enabled` is the only
	// variable across the two tests: with it off the controller must still stay
	// hidden; with it on the gate lets the suggestion through.
	function createController(): GhostCellController {
		const notebook = stubInterface<IPositronNotebookInstance>({
			uri: URI.parse('file:///test.ipynb'),
			cells: observableValue('cells', []),
			container: observableValue<HTMLElement | undefined>('container', undefined),
			textModel: stubInterface<NotebookTextModel>({
				metadata: { metadata: { positron: { assistant: { ghostCellSuggestions: 'enabled' } } } },
			}),
		});
		return ctx.instantiationService.createInstance(GhostCellController, notebook);
	}

	it('stays hidden when ai.enabled is false, even with the per-notebook override on', () => {
		config.setUserConfiguration(AI_ENABLED_KEY, false);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('hidden');
		controller.dispose();
	});

	it('lets the suggestion through when ai.enabled is true', () => {
		config.setUserConfiguration(AI_ENABLED_KEY, true);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('loading');
		controller.dispose();
	});
});
