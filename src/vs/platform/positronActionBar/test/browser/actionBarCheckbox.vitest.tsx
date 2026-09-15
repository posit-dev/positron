/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ActionBarCheckbox } from '../../browser/components/actionBarCheckbox.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';

// The checkbox reads the action bar's hover manager out of context, so it needs the provider tree
// that setupRTLRenderer puts around it. The assertions go through the accessibility tree rather
// than the DOM, because the point of the component is what a screen reader is told about it.
describe('ActionBarCheckbox', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderCheckbox = (overrides?: Partial<React.ComponentProps<typeof ActionBarCheckbox>>) => {
		const onChanged = vi.fn();
		rtl.render(
			<ActionBarCheckbox
				checked={false}
				label='Word Wrap'
				onChanged={onChanged}
				{...overrides}
			/>
		);
		return { onChanged, checkbox: screen.getByRole('checkbox') };
	};

	it('uses its visible label as its accessible name and reports its checked state', () => {
		const { checkbox } = renderCheckbox({ checked: true });

		expect(checkbox).toHaveAccessibleName('Word Wrap');
		expect(checkbox).toBeChecked();
	});

	it('prefers an explicit ariaLabel over the visible label', () => {
		const { checkbox } = renderCheckbox({ ariaLabel: 'Wrap long lines' });

		expect(checkbox).toHaveAccessibleName('Wrap long lines');
		expect(checkbox).not.toBeChecked();
	});

	it('requests the inverse value without changing its controlled checked state', async () => {
		const user = userEvent.setup();
		const { onChanged, checkbox } = renderCheckbox({ checked: true });

		await user.click(checkbox);

		// The parent owns the value, so the checkbox asks for the opposite of what it was given
		// and stays where it is until the parent says otherwise.
		expect(onChanged).toHaveBeenCalledWith(false);
		expect(checkbox).toBeChecked();
	});

	it('activates on Space and Enter', async () => {
		const user = userEvent.setup();
		const { onChanged, checkbox } = renderCheckbox();

		checkbox.focus();
		await user.keyboard('[Space]');
		await user.keyboard('[Enter]');

		// Two activations, not four: neither key may also fire the click the browser synthesizes
		// for a native <button>.
		expect(onChanged).toHaveBeenCalledTimes(2);
		expect(onChanged).toHaveBeenNthCalledWith(1, true);
		expect(onChanged).toHaveBeenNthCalledWith(2, true);
	});

	it('uses native disabled semantics and ignores clicks', async () => {
		const user = userEvent.setup();
		const { onChanged, checkbox } = renderCheckbox({ disabled: true });

		expect(checkbox).toBeDisabled();
		checkbox.focus();
		expect(checkbox).not.toHaveFocus();

		await user.click(checkbox);
		expect(onChanged).not.toHaveBeenCalled();
	});
});
