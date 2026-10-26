/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession } from '../../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { IPositronNotebookCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellProvider } from '../../../browser/notebookCells/CellProvider.js';
import { registerTestErrorActionHandler } from '../../../../positronAssistant/test/browser/errorActionTestUtils.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../../../common/notebookContextKeys.js';
import { NotebookCellQuickFix } from '../../../browser/notebookCells/NotebookCellQuickFix.js';

describe('NotebookCellQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const ask = vi.fn();

	// Give errors somewhere to go, so only the notebook's own gates are tested.
	let registration: IDisposable;
	beforeEach(() => {
		ask.mockReset().mockResolvedValue(undefined);
		registration = registerTestErrorActionHandler(ctx, { ask });
	});

	/** Set the quick fix's gates; each defaults to showing the buttons. */
	function setGates(gates: { notebookEnabled?: boolean; notebookAiEnabled?: boolean } = {}) {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(POSITRON_NOTEBOOK_ENABLED_KEY, gates.notebookEnabled ?? true);
		if (gates.notebookAiEnabled !== undefined) {
			ctx.get(IContextKeyService).createKey(NotebookContextKeys.aiEnabled.key, gates.notebookAiEnabled);
		}
	}

	const instance = stubInterface<IPositronNotebookInstance>({
		uri: URI.file('/work/analysis.ipynb'),
		runtimeSession: constObservable(stubInterface<ILanguageRuntimeSession>({ sessionId: 'python-5678' })),
	});

	/**
	 * A cell whose index and content the test can change after rendering, the
	 * way edits and deletions change a real cell. An index of -1 means the cell
	 * was removed from the notebook.
	 */
	function createCell() {
		const state = { index: 2, content: 'x + 1' };
		const cell = stubInterface<IPositronNotebookCell>({
			get index() { return state.index; },
			getContent: () => state.content,
			model: stubInterface<IPositronNotebookCell['model']>({ language: 'python' }),
		});
		return { cell, state };
	}

	function renderQuickFix() {
		const { cell, state } = createCell();
		rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellProvider cell={cell}>
					<NotebookCellQuickFix errorContent='NameError: name "x" is not defined' />
				</CellProvider>
			</NotebookInstanceProvider>
		);
		return state;
	}

	const quickFixGroup = { name: 'Cell output quick fix actions' };

	it('sends the error with the notebook, cell, and session', async () => {
		setGates();
		const user = userEvent.setup();
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask Test Assistant to fix in new chat' }));

		expect(ask).toHaveBeenCalledWith('fix', {
			kind: 'notebook',
			error: 'NameError: name "x" is not defined',
			uri: instance.uri,
			cell: { index: 2, code: 'x + 1', languageId: 'python' },
			sessionId: 'python-5678',
		}, { continueChat: false });
	});

	it('reads the cell\'s index and code when the button is clicked, not when it renders', async () => {
		setGates();
		const user = userEvent.setup();
		const cell = renderQuickFix();
		// Edit the cell and insert one above it after the error.
		cell.content = 'x = 1\nx + 1';
		cell.index = 3;
		await user.click(screen.getByRole('button', { name: 'Ask Test Assistant to fix in new chat' }));

		expect(ask.mock.calls[0][1]).toMatchObject({ cell: { index: 3, code: 'x = 1\nx + 1', languageId: 'python' } });
	});

	it('sends only the notebook and session once the cell is removed', async () => {
		setGates();
		const user = userEvent.setup();
		const cell = renderQuickFix();
		cell.index = -1;
		await user.click(screen.getByRole('button', { name: 'Ask Test Assistant to fix in new chat' }));

		expect(ask.mock.calls[0][1]).toEqual({
			kind: 'notebook',
			error: 'NameError: name "x" is not defined',
			uri: instance.uri,
			cell: undefined,
			sessionId: 'python-5678',
		});
	});

	it('shows the buttons before the notebook AI context key is bound', () => {
		setGates();
		renderQuickFix();
		expect(screen.getByRole('group', quickFixGroup)).toBeInTheDocument();
	});

	it('hides the buttons when notebook AI is off', () => {
		setGates({ notebookAiEnabled: false });
		renderQuickFix();
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();
	});

	it('hides the buttons when no handler can take errors', () => {
		registration.dispose();
		setGates();
		renderQuickFix();
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();
	});

	it('hides the buttons when Positron notebooks are off', () => {
		setGates({ notebookEnabled: false });
		renderQuickFix();
		expect(screen.queryByRole('group', quickFixGroup)).not.toBeInTheDocument();
	});
});
