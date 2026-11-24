/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PlotAgentAttribution } from '../../browser/components/plotAgentAttribution.js';

describe('PlotAgentAttribution', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand: vi.fn().mockResolvedValue(undefined) })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('reveals where the agent ran the code when clicked', async () => {
		const user = userEvent.setup();
		const location = { conversationId: 'c', messageId: 'm' };
		rtl.render(<PlotAgentAttribution agent={{
			name: 'Posit Assistant',
			revealCommand: { command: 'posit-assistant.revealMessage', arguments: [location] },
		}} />);

		await user.click(screen.getByRole('button', { name: 'Show where Posit Assistant created this plot' }));

		expect(ctx.get(ICommandService).executeCommand).toHaveBeenCalledWith('posit-assistant.revealMessage', location);
	});

	it('names an agent that cannot reveal where it ran the code, without a button', () => {
		rtl.render(<PlotAgentAttribution agent={{ name: 'Claude Code' }} />);

		expect(screen.getByText('Claude Code')).toBeInTheDocument();
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});
