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
import { registerTestErrorAssistant } from '../../../../positronAssistant/test/browser/errorAssistantTestUtils.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../../../common/positronNotebookConfig.js';
import { NotebookContextKeys } from '../../../common/notebookContextKeys.js';
import { NotebookCellQuickFix } from '../../../browser/notebookCells/NotebookCellQuickFix.js';

describe('NotebookCellQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const run = vi.fn();

	// Give errors somewhere to go, so only the notebook's own gates are tested.
	let registration: IDisposable;
	beforeEach(() => {
		run.mockReset().mockResolvedValue(undefined);
		registration = registerTestErrorAssistant(ctx, { run });
	});

	/** Set the quick fix's gates; each defaults to showing the buttons. */
	function setGates(gates: { notebookEnabled?: boolean; notebookAiEnabled?: boolean } = {}) {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(POSITRON_NOTEBOOK_ENABLED_KEY, gates.notebookEnabled ?? true);
		if (gates.notebookAiEnabled !== undefined) {
			ctx.get(IContextKeyService).createKey(NotebookContextKeys.aiEnabled.key, gates.notebookAiEnabled);
		}
	}

	function renderQuickFix() {
		return rtl.render(<NotebookCellQuickFix errorContent='NameError: name "x" is not defined' />);
	}

	const quickFixGroup = { name: 'Cell output quick fix actions' };

	it('sends the error as a notebook error, without ANSI escape codes', async () => {
		setGates();
		const user = userEvent.setup();
		rtl.render(<NotebookCellQuickFix errorContent={'\u001b[31mNameError\u001b[0m: name "x" is not defined'} />);
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(run).toHaveBeenCalledWith('fix', { error: 'NameError: name "x" is not defined', location: { kind: 'notebook' } }, { continueChat: false });
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

	it('hides the buttons when no assistant can take errors', () => {
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
