/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { Checkbox } from '../../components/checkbox.js';

describe('Checkbox', () => {
	const rtl = setupRTLRenderer();

	it('reports initialChecked as its checked state and toggles it on click', async () => {
		const user = userEvent.setup();
		const onChanged = vi.fn();
		rtl.render(<Checkbox initialChecked label='Use intrinsic size' onChanged={onChanged} />);
		const checkbox = screen.getByRole('checkbox', { name: 'Use intrinsic size' });

		expect(checkbox).toBeChecked();

		await user.click(checkbox);
		expect(checkbox).not.toBeChecked();
		expect(onChanged).toHaveBeenLastCalledWith(false);
	});
});
