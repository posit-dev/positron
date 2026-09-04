/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { useRef, useState } from 'react';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useRegisterWithActionBar } from '../../browser/useRegisterWithActionBar.js';
import { PositronActionBarContextProvider } from '../../browser/positronActionBarContext.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';

/**
 * A control that joins the bar's roving tabindex, passing an inline array literal the way every
 * real call site does.
 */
const Control = ({ label }: { label: string }) => {
	const ref = useRef<HTMLButtonElement>(undefined!);
	useRegisterWithActionBar([ref]);
	return <button ref={ref} aria-label={label} />;
};

/**
 * A control that re-renders on its own, from its own state, while the rest of the bar sits still.
 * This is what ActionBarCommandButton does when a context key flips its enabled state, and it is
 * the case that matters: a re-render driven from the parent re-runs every control's effect, which
 * empties the set and hands the tab stop straight back to the first control.
 */
const SelfRerenderingControl = ({ label }: { label: string }) => {
	const ref = useRef<HTMLButtonElement>(undefined!);
	const [count, setCount] = useState(0);
	useRegisterWithActionBar([ref]);
	return <button ref={ref} aria-label={label} onClick={() => setCount(count + 1)}>{count}</button>;
};

// The bar hands out one tab index of 0 and gives every other control -1, so Tab reaches the bar
// once and the arrow keys move within it. Nothing puts that 0 back except an arrow, Home or End
// keypress, so a control that drops it on re-render leaves the whole bar unreachable by Tab.
describe('useRegisterWithActionBar', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderBar = () => {
		rtl.render(
			<PositronActionBarContextProvider>
				<SelfRerenderingControl label='First' />
				<Control label='Second' />
			</PositronActionBarContextProvider>
		);

		return {
			first: () => screen.getByRole('button', { name: 'First' }),
			second: () => screen.getByRole('button', { name: 'Second' })
		};
	};

	it('gives the bar exactly one tab stop', () => {
		const { first, second } = renderBar();

		expect(first()).toHaveAttribute('tabindex', '0');
		expect(second()).toHaveAttribute('tabindex', '-1');
	});

	it('keeps the tab stop when the control holding it re-renders', async () => {
		const user = userEvent.setup();
		const { first, second } = renderBar();

		await user.click(first());

		expect(first()).toHaveAttribute('tabindex', '0');
		expect(second()).toHaveAttribute('tabindex', '-1');
	});
});
