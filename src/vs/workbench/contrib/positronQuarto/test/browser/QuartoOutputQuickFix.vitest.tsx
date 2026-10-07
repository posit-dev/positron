/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { Event } from '../../../../../base/common/event.js';
import { IErrorActionHandler, IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { QuartoOutputQuickFix } from '../../browser/QuartoOutputQuickFix.js';
import { URI } from '../../../../../base/common/uri.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

/** Kernel manager whose documents all share one session. */
const quartoKernelManager: Partial<IQuartoKernelManager> = {
	getSessionForDocument: () => stubInterface<ILanguageRuntimeSession>({ sessionId: 'python-5678' }),
};

const errorActionHandler: IErrorActionHandler = { id: 'test-agent', label: 'Test Agent', run: async () => { } };

describe('QuartoOutputQuickFix', () => {
	/** The handler errors go to; undefined when there is none. */
	let configuredHandler: IErrorActionHandler | undefined;
	const run = vi.fn().mockResolvedValue(undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IErrorActionsService, { onDidChange: Event.None, getConfigured: () => configuredHandler, run })
		.stub(IQuartoKernelManager, quartoKernelManager)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		configuredHandler = errorActionHandler;
	});

	function setAiEnabled(aiEnabled: boolean) {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('ai.enabled', aiEnabled);
	}

	function renderQuickFix() {
		return rtl.render(<QuartoOutputQuickFix errorContent='NameError: name "x" is not defined' />);
	}

	it('renders Fix/Explain buttons when AI is enabled and there is a handler', () => {
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

	it('does not render the buttons when there is no handler to send errors to', () => {
		setAiEnabled(true);
		configuredHandler = undefined;
		renderQuickFix();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('sends the failing chunk\'s location, code, and error', async () => {
		const user = userEvent.setup();
		setAiEnabled(true);
		rtl.render(
			<QuartoOutputQuickFix
				cellContext={{ uri: URI.file('/work/report.qmd'), path: 'report.qmd', language: 'python', label: 'setup', code: 'raise RuntimeError("boom")', codeStartLine: 8, codeEndLine: 9 }}
				errorContent='RuntimeError: boom'
			/>
		);
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(run.mock.calls[0].slice(1)).toEqual(['fix', {
			error: 'RuntimeError: boom',
			location: { kind: 'quarto', uri: URI.file('/work/report.qmd'), languageId: 'python', startLine: 8, endLine: 9, code: 'raise RuntimeError("boom")', label: 'setup', sessionId: 'python-5678' },
			chat: 'new',
		}]);
	});

	it('sends only the error when the chunk is not known', async () => {
		const user = userEvent.setup();
		setAiEnabled(true);
		renderQuickFix();
		await user.click(screen.getByRole('button', { name: 'Ask Test Agent to fix in new chat' }));

		expect(run.mock.calls[0].slice(1)).toEqual(['fix', { error: 'NameError: name "x" is not defined', location: undefined, chat: 'new' }]);
	});
});
