/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../../../base/common/event.js';
import { observableValue } from '../../../../../../../base/common/observable.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService, NullLogService } from '../../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { INotebookExecutionStateService } from '../../../../../notebook/common/notebookExecutionStateService.js';
import { NotebookTextModel } from '../../../../../notebook/common/model/notebookTextModel.js';
import { AI_ENABLED_KEY } from '../../../../../positronAssistant/common/positronAIConfiguration.js';
import { NOTEBOOK_AI_ENABLED_KEY } from '../../../../common/positronNotebookConfig.js';
import { IPositronNotebookCell, IPositronNotebookCodeCell } from '../../../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../../IPositronNotebookInstance.js';
import { GhostCellController } from '../controller.js';

describe('GhostCellController ai.enabled gate', () => {
	const config = new TestConfigurationService();
	const ctx = createTestContainer()
		.stub(IConfigurationService, config)
		.stub(INotebookExecutionStateService, stubInterface<INotebookExecutionStateService>({ onDidChangeExecution: Event.None }))
		.stub(INotificationService, stubInterface<INotificationService>())
		.stub(ILogService, new NullLogService())
		.build();

	// The per-notebook override turns ghost cells ON, so `ai.enabled` is the only
	// variable across the two tests: with it off the controller must still stay
	// hidden; with it on the gate lets the suggestion through.
	function createController(): GhostCellController {
		const mockCell = stubInterface<IPositronNotebookCell>({
			isCodeCell: function (this: IPositronNotebookCell): this is IPositronNotebookCodeCell { return true; },
			getContent: () => '',
			outputs: observableValue('outputs', []),
		});
		const notebook = stubInterface<IPositronNotebookInstance>({
			uri: URI.parse('file:///test.ipynb'),
			cells: observableValue('cells', [mockCell]),
			container: observableValue<HTMLElement | undefined>('container', undefined),
			runtimeSession: observableValue('runtimeSession', undefined),
			textModel: stubInterface<NotebookTextModel>({
				metadata: { metadata: { positron: { assistant: { ghostCellSuggestions: 'enabled' } } } },
				cells: undefined,
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

describe('GhostCellController notebook.ai.enabled gate', () => {
	const config = new TestConfigurationService();
	const ctx = createTestContainer()
		.stub(IConfigurationService, config)
		.stub(INotebookExecutionStateService, stubInterface<INotebookExecutionStateService>({ onDidChangeExecution: Event.None }))
		.stub(INotificationService, stubInterface<INotificationService>())
		.stub(ILogService, new NullLogService())
		.build();

	// The per-notebook override turns ghost cells ON, so the two AI switches are
	// the only variables. notebook.ai.enabled (default true) sits below ai.enabled
	// and above the feature's own gates: a suggestion goes through only when BOTH
	// switches are on. Disabling either keeps the controller hidden.
	function createController(): GhostCellController {
		const mockCell = stubInterface<IPositronNotebookCell>({
			isCodeCell: function (this: IPositronNotebookCell): this is IPositronNotebookCodeCell { return true; },
			getContent: () => '',
			outputs: observableValue('outputs', []),
		});
		const notebook = stubInterface<IPositronNotebookInstance>({
			uri: URI.parse('file:///test.ipynb'),
			cells: observableValue('cells', [mockCell]),
			container: observableValue<HTMLElement | undefined>('container', undefined),
			runtimeSession: observableValue('runtimeSession', undefined),
			textModel: stubInterface<NotebookTextModel>({
				metadata: { metadata: { positron: { assistant: { ghostCellSuggestions: 'enabled' } } } },
				cells: undefined,
			}),
		});
		return ctx.instantiationService.createInstance(GhostCellController, notebook);
	}

	it('stays hidden when notebook.ai.enabled is false, even with ai.enabled on and the per-notebook override on', () => {
		config.setUserConfiguration(AI_ENABLED_KEY, true);
		config.setUserConfiguration(NOTEBOOK_AI_ENABLED_KEY, false);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('hidden');
		controller.dispose();
	});

	it('lets the suggestion through when ai.enabled and notebook.ai.enabled are both true', () => {
		config.setUserConfiguration(AI_ENABLED_KEY, true);
		config.setUserConfiguration(NOTEBOOK_AI_ENABLED_KEY, true);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('loading');
		controller.dispose();
	});

	it('lets the suggestion through when ai.enabled is true and notebook.ai.enabled is unset (defaults to enabled)', () => {
		// notebook.ai.enabled defaults to true, so an unset value must not disable
		// notebook AI; only an explicit `false` does.
		config.setUserConfiguration(AI_ENABLED_KEY, true);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('loading');
		controller.dispose();
	});

	it('stays hidden when ai.enabled is false even if notebook.ai.enabled is true (global switch wins)', () => {
		config.setUserConfiguration(AI_ENABLED_KEY, false);
		config.setUserConfiguration(NOTEBOOK_AI_ENABLED_KEY, true);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('hidden');
		controller.dispose();
	});
});
