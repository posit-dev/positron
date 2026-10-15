/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ErrorActionsService } from '../../../positronAssistant/browser/errorActionsService.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { QuartoOutputQuickFix } from '../../browser/QuartoOutputQuickFix.js';
import { QuartoCellErrorContext } from '../../common/quartoExecutionTypes.js';

describe('QuartoOutputQuickFix', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	// Replace the preset's inert stub with a real service, so tests can register handlers.
	beforeEach(() => {
		ctx.instantiationService.stub(IErrorActionsService, ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionsService)));
	});
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const run = vi.fn();

	/** Register the handler errors are sent to. */
	function registerHandler(): IDisposable {
		return ctx.disposables.add(ctx.get(IErrorActionsService).register({ id: 'test-agent', label: 'Test Agent', canContinueChat: true, run }));
	}

	// Give errors somewhere to go, so only Quarto's own gate is tested.
	let registration: IDisposable;
	beforeEach(() => {
		run.mockReset().mockResolvedValue(undefined);
		registration = registerHandler();
	});

	function setAiEnabled(aiEnabled: boolean) {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('ai.enabled', aiEnabled);
	}

	function renderQuickFix(cellContext?: QuartoCellErrorContext) {
		return rtl.render(<QuartoOutputQuickFix cellContext={cellContext} errorContent='NameError: name "x" is not defined' />);
	}

	it('renders Fix/Explain buttons when AI is enabled', () => {
		setAiEnabled(true);
		renderQuickFix();
		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
	});

	it('renders the buttons when ai.enabled is unset (defaults to enabled)', () => {
		renderQuickFix();
		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
	});

	it('does not render the buttons when AI features are disabled', () => {
		setAiEnabled(false);
		renderQuickFix();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('does not render the buttons when no handler can take errors', () => {
		registration.dispose();
		renderQuickFix();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('notifies the host to re-measure when a handler registers after the first render', () => {
		registration.dispose();
		const onLayout = vi.fn();
		rtl.render(<QuartoOutputQuickFix errorContent='NameError: name "x" is not defined' onLayout={onLayout} />);
		onLayout.mockClear();

		act(() => { registerHandler(); });

		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
		expect(onLayout).toHaveBeenCalled();
	});

	it('sends the error with the chunk that raised it', async () => {
		const user = userEvent.setup();
		renderQuickFix({ path: 'report.qmd', language: 'python', label: 'setup', code: 'raise RuntimeError("boom")', codeStartLine: 8, codeEndLine: 9 });
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(run).toHaveBeenCalledWith('fix', {
			error: 'NameError: name "x" is not defined',
			location: {
				kind: 'quarto',
				chunk: { path: 'report.qmd', languageId: 'python', label: 'setup', code: 'raise RuntimeError("boom")', startLine: 8, endLine: 9 },
			},
			chat: 'new',
		});
	});

	it('sends the error without a chunk when it cannot be found', async () => {
		const user = userEvent.setup();
		renderQuickFix(undefined);
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(run).toHaveBeenCalledWith('fix', { error: 'NameError: name "x" is not defined', location: { kind: 'quarto', chunk: undefined }, chat: 'new' });
	});
});
