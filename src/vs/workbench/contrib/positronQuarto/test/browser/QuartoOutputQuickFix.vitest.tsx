/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { registerTestErrorAssistant } from '../../../positronAssistant/test/browser/errorAssistantTestUtils.js';
import { QuartoOutputQuickFix } from '../../browser/QuartoOutputQuickFix.js';
import { IQuartoErroredCell } from '../../../positronAssistant/common/errorAssistant.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';

describe('QuartoOutputQuickFix', () => {
	const getSessionForDocument = vi.fn((_uri: URI) => stubInterface<ILanguageRuntimeSession>({ sessionId: 'python-1234' }));
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IQuartoKernelManager, { getSessionForDocument })
		.build();

	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const ask = vi.fn();

	// Give errors somewhere to go.
	let registration: IDisposable;
	beforeEach(() => {
		ask.mockReset().mockResolvedValue(undefined);
		registration = registerTestErrorAssistant(ctx, { ask });
	});

	function renderQuickFix(cell?: IQuartoErroredCell) {
		return rtl.render(<QuartoOutputQuickFix cell={cell} errorContent='NameError: name "x" is not defined' />);
	}

	it('renders Fix/Explain buttons when an assistant can take errors', () => {
		renderQuickFix();
		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
	});

	it('does not render the buttons when no assistant can take errors', () => {
		registration.dispose();
		renderQuickFix();
		expect(screen.queryByRole('group', { name: /quick fix/i })).not.toBeInTheDocument();
	});

	it('notifies the host to re-measure when an assistant registers after the first render', () => {
		registration.dispose();
		const onLayout = vi.fn();
		rtl.render(<QuartoOutputQuickFix errorContent='NameError: name "x" is not defined' onLayout={onLayout} />);
		onLayout.mockClear();

		act(() => { registerTestErrorAssistant(ctx, { ask }); });

		expect(screen.getByRole('group', { name: /quick fix/i })).toBeInTheDocument();
		expect(onLayout).toHaveBeenCalled();
	});

	it('sends the error with the cell that raised it and its document\'s session', async () => {
		const user = userEvent.setup();
		const uri = URI.file('/report.qmd');
		renderQuickFix({ uri, languageId: 'python', label: 'setup', code: 'raise RuntimeError("boom")', startLine: 8, endLine: 9 });
		await user.click(screen.getByRole('button', { name: 'Ask Test Assistant to fix in new chat' }));

		expect(ask).toHaveBeenCalledWith('fix', {
			kind: 'quarto',
			error: 'NameError: name "x" is not defined',
			cell: { uri, languageId: 'python', label: 'setup', code: 'raise RuntimeError("boom")', startLine: 8, endLine: 9 },
			sessionId: 'python-1234',
		}, { continueChat: false });
		expect(getSessionForDocument).toHaveBeenCalledWith(uri);
	});

	it('sends the error without a cell when it cannot be found', async () => {
		const user = userEvent.setup();
		renderQuickFix(undefined);
		await user.click(screen.getByRole('button', { name: 'Ask Test Assistant to fix in new chat' }));

		expect(ask).toHaveBeenCalledWith('fix', { kind: 'quarto', error: 'NameError: name "x" is not defined', cell: undefined }, { continueChat: false });
	});
});
