/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IStatusbarEntryAccessor, IStatusbarService, } from '../../../../services/statusbar/browser/statusbar.js';
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { TestNotebookExecutionService } from '../../../../test/common/positronWorkbenchTestServices.js';
import { NotebookExecutionStatus } from '../../browser/notebookExecutionStatus.js';
import { NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY } from '../../common/runtimeNotebookKernelConfig.js';

suite('NotebookExecutionStatus', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let configurationService: TestConfigurationService;
	let notebookExecutionService: TestNotebookExecutionService;
	let statusbarService: IStatusbarService;
	let entry: sinon.SinonSpiedInstance<IStatusbarEntryAccessor>;

	setup(() => {
		const instantiationService = positronWorkbenchInstantiationService(disposables);
		const accessor = instantiationService.createInstance(PositronTestServiceAccessor);
		configurationService = accessor.configurationService;
		notebookExecutionService = accessor.notebookExecutionService;
		statusbarService = accessor.statusbarService;

		const notebookExecutionStatus = disposables.add(instantiationService.createInstance(NotebookExecutionStatus));
		entry = sinon.spy(notebookExecutionStatus.entry);
	});

	test('becomes visible when configuration is enabled', () => {
		assert.strictEqual(statusbarService.isEntryVisible(NotebookExecutionStatus.ID), false);

		configurationService.setUserConfiguration(NOTEBOOK_EXPERIMENTAL_SHOW_EXECUTION_INFO_KEY, true);
		configurationService.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: () => true } as any);

		assert.strictEqual(statusbarService.isEntryVisible(NotebookExecutionStatus.ID), true);
	});

	test('updates text when notebook cells execution starts', async () => {
		notebookExecutionService.onDidStartNotebookCellsExecutionEmitter.fire({ cellHandles: [1] });

		const text = 'Executing 1 cell';
		sinon.assert.calledOnceWithExactly(entry.update, {
			name: NotebookExecutionStatus.NAME,
			ariaLabel: text,
			text,
		});
	});

	test('updates text when notebook cells execution ends', async () => {
		notebookExecutionService.onDidEndNotebookCellsExecutionEmitter.fire({ cellHandles: [1], duration: 100 });

		const text = 'Executed 1 cell in 100ms';
		sinon.assert.calledOnceWithExactly(entry.update, {
			name: NotebookExecutionStatus.NAME,
			ariaLabel: text,
			text,
		});
	});
});
