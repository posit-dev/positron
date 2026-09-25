/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILabelService } from '../../../../../../platform/label/common/label.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { IErrorActionTarget, IErrorActionTargetService } from '../../../../positronAssistant/common/errorActionTargets.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../../common/positronNotebookConfig.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { IPositronNotebookCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellProvider } from '../../../browser/notebookCells/CellProvider.js';
import { NotebookCellQuickFix } from '../../../browser/notebookCells/NotebookCellQuickFix.js';

const target: IErrorActionTarget = { id: 'claude-code', label: 'Claude Code', command: 'test.sendError' };

describe('NotebookCellQuickFix', () => {
	const run = vi.fn().mockResolvedValue(undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IErrorActionTargetService, { onDidChange: Event.None, getConfiguredTarget: () => target, run })
		.stub(ILabelService, { getUriLabel: () => 'analysis.ipynb' })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('tells the assistant which cell failed and includes its code', async () => {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(POSITRON_NOTEBOOK_ENABLED_KEY, true);
		const instance = stubInterface<IPositronNotebookInstance>({ uri: URI.file('/work/analysis.ipynb') });
		const cell = stubInterface<IPositronNotebookCell>({ index: 2, getContent: () => 'x + 1' });

		const user = userEvent.setup();
		rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellProvider cell={cell}>
					<NotebookCellQuickFix errorContent={'NameError: x'} />
				</CellProvider>
			</NotebookInstanceProvider>
		);
		await user.click(screen.getByRole('button', { name: 'Ask Claude Code to fix in new chat' }));

		expect(run.mock.calls[0][1]).toEqual({
			action: 'fix',
			conversation: 'new',
			prompt: 'Fix the error from cell 3 of analysis.ipynb. The failing code and its error output are attached; fix only this error.',
			context: 'Error from cell 3 of analysis.ipynb:\n\n--- Failing code ---\nx + 1\n\n--- Error output ---\nNameError: x',
			contextName: 'Notebook Cell Error',
		});
	});
});
