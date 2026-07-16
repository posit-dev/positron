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
import { IContextKeyService } from '../../../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { INotebookExecutionStateService } from '../../../../../notebook/common/notebookExecutionStateService.js';
import { NotebookTextModel } from '../../../../../notebook/common/model/notebookTextModel.js';
import { NotebookContextKeys } from '../../../../common/notebookContextKeys.js';
import { IPositronNotebookCell, IPositronNotebookCodeCell } from '../../../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../../IPositronNotebookInstance.js';
import { GhostCellController } from '../controller.js';

describe('GhostCellController notebook AI gate', () => {
	const config = new TestConfigurationService();
	const contextKeyService = new MockContextKeyService();
	const ctx = createTestContainer()
		.stub(IConfigurationService, config)
		.stub(IContextKeyService, contextKeyService)
		.stub(INotebookExecutionStateService, stubInterface<INotebookExecutionStateService>({ onDidChangeExecution: Event.None }))
		.stub(INotificationService, stubInterface<INotificationService>())
		.stub(ILogService, new NullLogService())
		.build();

	// The per-notebook override turns ghost cells ON, so the composite notebook AI
	// context key is the only variable: with it off the controller stays hidden,
	// with it on the gate lets the suggestion through. (The ai.enabled vs
	// notebook.ai.enabled composition that drives this key lives in
	// notebookAIEnabledContextKey.vitest.ts.) Each test sets the key explicitly,
	// so order doesn't matter.
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

	it('stays hidden when the notebook AI gate is off, even with the per-notebook override on', () => {
		contextKeyService.createKey(NotebookContextKeys.aiEnabled.key, false);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('hidden');
		controller.dispose();
	});

	it('lets the suggestion through when the notebook AI gate is on', () => {
		contextKeyService.createKey(NotebookContextKeys.aiEnabled.key, true);
		const controller = createController();

		controller.triggerGhostCellSuggestion(0);

		expect(controller.ghostCellState.get().status).toBe('loading');
		controller.dispose();
	});
});
