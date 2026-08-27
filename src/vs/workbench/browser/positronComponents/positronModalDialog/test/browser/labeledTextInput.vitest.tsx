/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { LabeledTextInput } from '../../components/labeledTextInput.js';

describe('LabeledTextInput', () => {
	const rtl = setupRTLRenderer();

	const errorMsg = 'Enter a valid variable name.';

	function renderInput(error: boolean) {
		rtl.render(
			<LabeledTextInput
				error={error}
				errorMsg={error ? errorMsg : undefined}
				label='Variable Name'
				value='2020 data'
				onChange={vi.fn()}
			/>
		);

		// By role, so the name comes from the accessible name computation rather than the label text.
		return screen.getByRole('textbox', { name: 'Variable Name' });
	}

	it('marks the input invalid and points at the message, leaving its name alone', () => {
		const input = renderInput(true);

		expect(input).toBeInvalid();
		expect(input).toHaveAccessibleDescription(errorMsg);
	});

	it('keeps the described element out of the live region, so it is not read twice', () => {
		renderInput(true);

		// A described element that is also a live region gets announced twice in Chrome with JAWS:
		// once as the description, once as the update. The visible message is the described one.
		expect(screen.getByText(errorMsg).parentElement).not.toHaveAttribute('aria-live');
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('announces the message once the user stops typing', async () => {
		renderInput(true);

		// The off-screen mirror lags the visible message, so someone typing does not hear a fresh
		// error per character.
		expect(screen.getByRole('status')).toBeEmptyDOMElement();
		await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(errorMsg));
	});

	it('has no error state to announce when the value is valid', () => {
		const input = renderInput(false);

		expect(input).toBeValid();
		expect(input).toHaveAccessibleDescription('');
	});
});
