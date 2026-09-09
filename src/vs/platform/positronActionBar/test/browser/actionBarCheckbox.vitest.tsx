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
		const { rerender } = rtl.render(
			<ActionBarCheckbox
				checked={false}
				label='Word Wrap'
				onChanged={onChanged}
				{...overrides}
			/>
		);
		return { onChanged, rerender, checkbox: screen.getByRole('checkbox') };
	};

	it('is named by its label and reports its checked state', () => {
		const { checkbox } = renderCheckbox({ checked: true });

		expect(checkbox).toHaveAccessibleName('Word Wrap');
		expect(checkbox).toBeChecked();
	});

	it('prefers an explicit ariaLabel over the visible label', () => {
		const { checkbox } = renderCheckbox({ ariaLabel: 'Wrap long lines' });

		expect(checkbox).toHaveAccessibleName('Wrap long lines');
		expect(checkbox).not.toBeChecked();
	});

	it('keeps the same name when it is checked', () => {
		const { checkbox, rerender } = renderCheckbox();

		expect(checkbox).toHaveAccessibleName('Word Wrap');

		// Without a name of its own the button would be named by its contents, and the only
		// content is the check codicon. The name would then appear and change as it is toggled.
		rerender(<ActionBarCheckbox checked={true} label='Word Wrap' onChanged={vi.fn()} />);
		expect(screen.getByRole('checkbox')).toHaveAccessibleName('Word Wrap');
	});

	it('flips its own state on click and reports the new value', async () => {
		const user = userEvent.setup();
		const { onChanged, checkbox } = renderCheckbox();

		await user.click(checkbox);

		// The checkbox owns its state and moves before the command has done anything. Replacing
		// this with the command's own state is a separate change.
		expect(checkbox).toBeChecked();
		expect(onChanged).toHaveBeenCalledWith(true);
	});

	it('follows the checked prop when it changes', () => {
		const { checkbox, rerender } = renderCheckbox();

		expect(checkbox).not.toBeChecked();

		rerender(<ActionBarCheckbox checked={true} label='Word Wrap' onChanged={vi.fn()} />);
		expect(screen.getByRole('checkbox')).toBeChecked();
	});

	it('keeps its own flip when the prop it is given has not changed', async () => {
		const user = userEvent.setup();
		const { checkbox, rerender } = renderCheckbox({ checked: true });

		await user.click(checkbox);
		expect(checkbox).not.toBeChecked();

		// The owner still says checked, and the checkbox goes on showing unchecked, because the
		// sync effect only runs when the prop's value changes. So the control can sit disagreeing
		// with the command that owns it. Making the checkbox read the command's state instead is
		// a separate change; this test records the behavior until then.
		rerender(<ActionBarCheckbox checked={true} label='Word Wrap' onChanged={vi.fn()} />);
		expect(screen.getByRole('checkbox')).not.toBeChecked();
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
	});
});
