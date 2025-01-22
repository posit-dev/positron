/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IStatusbarService, } from '../../../../services/statusbar/browser/statusbar.js';
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { TestNotebookExecutionService } from '../../../../test/common/positronWorkbenchTestServices.js';
import { NotebookExecutionStatus } from '../../browser/notebookExecutionStatus.js';
import { NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY } from '../../common/runtimeNotebookKernelConfig.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';

suite('NotebookExecutionStatus', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let configurationService: TestConfigurationService;
	let notebookExecutionService: TestNotebookExecutionService;
	let statusbarService: IStatusbarService;

	setup(() => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		const accessor = instantiationService.createInstance(PositronTestServiceAccessor);
		configurationService = accessor.configurationService;
		notebookExecutionService = accessor.notebookExecutionService;
		statusbarService = accessor.statusbarService;
	});

	function createEntry() {
		const notebookExecutionStatus = disposables.add(instantiationService.createInstance(NotebookExecutionStatus));
		return sinon.spy(notebookExecutionStatus.entry);
	}

	function setShowExecutionInfo(value: boolean) {
		configurationService.setUserConfiguration(NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY, value);
	}

	function assertEntryIsVisible(visible: boolean) {
		assert.strictEqual(statusbarService.isEntryVisible(NotebookExecutionStatus.ID), visible);
	}

	test('initially hidden', () => {
		createEntry();

		assertEntryIsVisible(false);
	});

	test('initially shown', () => {
		setShowExecutionInfo(true);

		createEntry();

		assertEntryIsVisible(true);
	});

	test('show on config enabled', () => {
		createEntry();

		setShowExecutionInfo(true);
		configurationService.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: () => true } as any);

		assertEntryIsVisible(true);
	});

	test('update on execution start', async () => {
		const entry = createEntry();

		notebookExecutionService.onDidStartNotebookCellsExecutionEmitter.fire({ cellHandles: [1] });

		const text = 'Executing 1 cell';
		sinon.assert.calledOnceWithExactly(entry.update, {
			name: NotebookExecutionStatus.NAME,
			ariaLabel: text,
			text,
		});
	});

	test('update on execution end', async () => {
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
