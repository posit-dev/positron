/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import sinon from 'sinon';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IStatusbarService, } from '../../../../services/statusbar/browser/statusbar.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { TestNotebookExecutionService } from '../../../../test/common/positronWorkbenchTestServices.js';
import { NotebookExecutionStatus } from '../../browser/notebookExecutionStatus.js';
import { NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY } from '../../common/runtimeNotebookKernelConfig.js';

describe('NotebookExecutionStatus', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();
	const disposables = ctx.disposables;
	let configurationService: TestConfigurationService;
	let notebookExecutionService: TestNotebookExecutionService;
	let statusbarService: IStatusbarService;

	beforeEach(() => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		configurationService = accessor.configurationService;
		notebookExecutionService = accessor.notebookExecutionService;
		statusbarService = accessor.statusbarService;
	});

	function createEntry() {
		const notebookExecutionStatus = disposables.add(ctx.instantiationService.createInstance(NotebookExecutionStatus));
		return sinon.spy(notebookExecutionStatus.entry);
	}

	function setShowExecutionInfo(value: boolean) {
		configurationService.setUserConfiguration(NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY, value);
	}

	function assertEntryIsVisible(visible: boolean) {
		expect(statusbarService.isEntryVisible(NotebookExecutionStatus.ID)).toBe(visible);
	}

	it('initially hidden', () => {
		createEntry();

		assertEntryIsVisible(false);
	});

	it('initially shown', () => {
		setShowExecutionInfo(true);

		createEntry();

		assertEntryIsVisible(true);
	});

	it('show on config enabled', () => {
		createEntry();

		setShowExecutionInfo(true);
		configurationService.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: () => true } as any);

		assertEntryIsVisible(true);
	});

	it('update on execution start', async () => {
		const entry = createEntry();

		notebookExecutionService.onDidStartNotebookCellsExecutionEmitter.fire({ cellHandles: [1] });

		const text = 'Executing 1 cell';
		sinon.assert.calledOnceWithExactly(entry.update, {
			name: NotebookExecutionStatus.NAME,
			ariaLabel: text,
			text,
		});
	});

	it('update on execution end', async () => {
		const entry = createEntry();

		notebookExecutionService.onDidEndNotebookCellsExecutionEmitter.fire({ cellHandles: [1], duration: 100 });

		const text = 'Executed 1 cell in 100ms';
		sinon.assert.calledOnceWithExactly(entry.update, {
			name: NotebookExecutionStatus.NAME,
			ariaLabel: text,
			text,
		});
	});
});
