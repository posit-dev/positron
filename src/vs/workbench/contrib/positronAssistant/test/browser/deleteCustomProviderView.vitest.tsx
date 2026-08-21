/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { DeleteCustomProviderView } from '../../browser/components/deleteCustomProviderView.js';

const gateway: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'My Gateway', displayName: 'My Gateway', customKind: 'openai-compatible' },
	supportedOptions: ['apiKey', 'baseUrl'],
	signedIn: true,
	defaults: { baseUrl: 'https://gateway.example.com/v1' },
};

describe('DeleteCustomProviderView', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('names the entry it is about to delete, and says the key goes with it', () => {
		rtl.render(<DeleteCustomProviderView source={gateway} onCancel={vi.fn()} onClose={vi.fn()} onDelete={vi.fn()} />);
		expect(screen.getByText(/Delete "My Gateway"\?.*API key.*cannot be undone/is)).toBeInTheDocument();
	});

	it('deletes on confirmation, and leaves it alone on Cancel', async () => {
		const onDelete = vi.fn().mockResolvedValue(undefined);
		const onCancel = vi.fn();
		const user = userEvent.setup();
		rtl.render(<DeleteCustomProviderView source={gateway} onCancel={onCancel} onClose={vi.fn()} onDelete={onDelete} />);

		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect({ deleted: onDelete.mock.calls.length, cancelled: onCancel.mock.calls.length }).toEqual({ deleted: 0, cancelled: 1 });

		await user.click(screen.getByRole('button', { name: 'Delete Provider' }));
		expect(onDelete).toHaveBeenCalledTimes(1);
	});

	// An entry from a default or enforced layer is refused by the extension, and
	// this screen is where the user reads why.
	it('shows the refusal inline and stays put, so the entry can still be cancelled out of', async () => {
		const onDelete = vi.fn().mockRejectedValue(new Error('"My Gateway" is managed outside Positron.'));
		const user = userEvent.setup();
		rtl.render(<DeleteCustomProviderView source={gateway} onCancel={vi.fn()} onClose={vi.fn()} onDelete={onDelete} />);

		await user.click(screen.getByRole('button', { name: 'Delete Provider' }));

		expect(screen.getByText('"My Gateway" is managed outside Positron.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Delete Provider' })).toBeEnabled();
	});
});
