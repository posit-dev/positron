/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IRuntimeSessionService, SessionStartReasonId } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IActiveNotebookEditor } from '../../../notebook/browser/notebookBrowser.js';
import { IPositronNotebookService } from '../../../positronNotebook/browser/positronNotebookService.js';
import { RuntimeNotebookKernelRestartAction } from '../../browser/runtimeNotebookKernelActions.js';
import { IRuntimeNotebookKernelService } from '../../common/interfaces/runtimeNotebookKernelService.js';

describe('RuntimeNotebookKernelRestartAction', () => {
	const notebookUri = URI.file('/path/to/notebook.ipynb');
	const ensureSessionStarted = vi.fn<IRuntimeNotebookKernelService['ensureSessionStarted']>();

	const ctx = createTestContainer()
		.stub(IEditorService, stubInterface<IEditorService>({}))
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			getNotebookSessionForNotebookUri: () => undefined,
		}))
		.stub(IRuntimeNotebookKernelService, stubInterface<IRuntimeNotebookKernelService>({ ensureSessionStarted }))
		.stub(IPositronNotebookService, stubInterface<IPositronNotebookService>({ listInstances: () => [] }))
		.stub(IConfigurationService, stubInterface<IConfigurationService>({}))
		.stub(IProgressService, stubInterface<IProgressService>({}))
		.stub(INotificationService, stubInterface<INotificationService>({}))
		.build();

	beforeEach(() => {
		ensureSessionStarted.mockReset();
	});

	it('names the entry point in the start reason when no kernel is running', async () => {
		const toolbarContext = {
			ui: true,
			source: 'notebookToolbar',
			notebookEditor: stubInterface<IActiveNotebookEditor>({
				textModel: stubInterface<IActiveNotebookEditor['textModel']>({ uri: notebookUri }),
			}),
		};

		for (const context of [notebookUri, toolbarContext]) {
			await ctx.instantiationService.invokeFunction(accessor =>
				new RuntimeNotebookKernelRestartAction().run(accessor, context as Parameters<RuntimeNotebookKernelRestartAction['run']>[1]));
		}

		expect(ensureSessionStarted.mock.calls).toEqual([
			[notebookUri, {
				id: SessionStartReasonId.NotebookKernelRestart,
				detail: 'Restart Kernel was used in notebook.ipynb with no kernel running (notebook: notebook.ipynb, restartSource: User clicked positron.runtimeNotebookKernel.restart button in Positron notebook editor action bar)',
			}],
			[notebookUri, {
				id: SessionStartReasonId.NotebookKernelRestart,
				detail: 'Restart Kernel was used in notebook.ipynb with no kernel running (notebook: notebook.ipynb, restartSource: User clicked positron.runtimeNotebookKernel.restart button in VSCode notebook editor toolbar)',
			}],
		]);
	});
});
