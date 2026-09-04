/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../test/vitest/reactTestingLibrary.js';
import { SegmentedToggle } from '../../browser/ui/positronComponents/segmentedToggle/segmentedToggle.js';

// SegmentedToggle takes everything through props and touches no services, so the renderer needs
// no service context. The assertions go through the accessibility tree rather than the DOM,
// because the point of the component is what a screen reader is told about it.
describe('SegmentedToggle', () => {
	const rtl = setupRTLRenderer();

	const renderToggle = (overrides?: Partial<React.ComponentProps<typeof SegmentedToggle>>) => {
		const onToggle = vi.fn();
		rtl.render(
			<SegmentedToggle
				ariaLabel='Edit Mode: Source'
				leftActive={true}
				leftLabel='Source'
				rightLabel='Visual'
				onToggle={onToggle}
				{...overrides}
			/>
		);
		return { onToggle, toggle: screen.getByRole('switch') };
	};

	it('is a switch with an accessible name, checked when the left option is active', () => {
		const { toggle } = renderToggle();

		expect(toggle).toHaveAccessibleName('Edit Mode: Source');
		expect(toggle).toBeChecked();
	});

	it('is unchecked when the right option is active', () => {
		const { toggle } = renderToggle({ ariaLabel: 'Edit Mode: Source', leftActive: false });

		expect(toggle).not.toBeChecked();
	});

	it('does not expose the option labels as separate controls', () => {
		renderToggle();

		// The labels are visible but hidden from assistive technology, so the whole control reads
		// as one switch instead of a group containing two things.
		expect(screen.queryByText('Source', { ignore: '[aria-hidden="true"], [aria-hidden="true"] *' })).not.toBeInTheDocument();
	});

	it('toggles on click, Space and Enter', async () => {
		const user = userEvent.setup();
		const { onToggle, toggle } = renderToggle();

		await user.click(toggle);
		toggle.focus();
		await user.keyboard('[Space]');
		await user.keyboard('[Enter]');

		// Three activations, not five: Space and Enter must not also fire the click the browser
		// synthesizes for a native <button>.
		expect(onToggle).toHaveBeenCalledTimes(3);
	});

	it('stays focusable when disabled but does nothing when activated', async () => {
		const user = userEvent.setup();
		const { onToggle, toggle } = renderToggle({ disabled: true });

		expect(toggle).toHaveAttribute('aria-disabled', 'true');

		// aria-disabled rather than the native attribute, so a keyboard user who lands here keeps
		// their place instead of being dropped out of the control.
		toggle.focus();
		expect(toggle).toHaveFocus();

		await user.keyboard('[Space]');
		expect(onToggle).not.toHaveBeenCalled();
	});
});
