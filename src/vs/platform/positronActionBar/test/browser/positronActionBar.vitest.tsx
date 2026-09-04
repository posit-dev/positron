/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { useRef, useState } from 'react';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronActionBar } from '../../browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../browser/positronActionBarContext.js';
import { useRegisterWithActionBar } from '../../browser/useRegisterWithActionBar.js';
import { ActionBarRegion } from '../../browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../browser/components/actionBarButton.js';
import { ActionBarCheckbox } from '../../browser/components/actionBarCheckbox.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';

/**
 * A button that joins the bar's roving tabindex, as the action bar's own adapters do. Its ref
 * reaches the DOM node through Button's imperative handle, which is the path a real control uses.
 */
const RegisteredButton = ({ label }: { label: string }) => {
	const ref = useRef<HTMLButtonElement>(undefined!);
	useRegisterWithActionBar([ref]);
	return <ActionBarButton ref={ref} ariaLabel={label} label={label} />;
};

/**
 * Stands in for Quarto's Render on Save: a checkbox an extension contributes to the middle of the
 * bar.
 */
const RegisteredCheckbox = ({ label }: { label: string }) => {
	const ref = useRef<HTMLButtonElement>(undefined!);
	useRegisterWithActionBar([ref]);
	return (
		<ActionBarCheckbox
			ref={ref}
			ariaLabel={label}
			checked={false}
			label={label}
			onChanged={() => { }}
		/>
	);
};

describe('PositronActionBar', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// The extension's control is absent on the first render and appears when `activate` is
	// pressed. That is the real sequence: the bar goes up with Positron's own controls, and an
	// extension contributes its own once it has finished activating.
	const renderBar = () => {
		const Bar = () => {
			const [extensionReady, setExtensionReady] = useState(false);
			return (
				<PositronActionBarContextProvider>
					<PositronActionBar ariaLabel='Editor actions'>
						<ActionBarRegion location='left'>
							<RegisteredButton label='Preview' />
							{extensionReady && <RegisteredCheckbox label='Render on Save' />}
						</ActionBarRegion>
						<ActionBarRegion location='right'>
							<RegisteredButton label='Open in new window' />
						</ActionBarRegion>
					</PositronActionBar>
					<button aria-label='activate' onClick={() => setExtensionReady(true)} />
				</PositronActionBarContextProvider>
			);
		};
		rtl.render(<Bar />);

		return {
			activate: () => screen.getByRole('button', { name: 'activate' }),
			preview: () => screen.getByRole('button', { name: 'Preview' }),
			checkbox: () => screen.getByRole('checkbox', { name: 'Render on Save' }),
			lastButton: () => screen.getByRole('button', { name: 'Open in new window' })
		};
	};

	it('announces itself as a named toolbar', () => {
		renderBar();

		expect(screen.getByRole('toolbar', { name: 'Editor actions' })).toBeInTheDocument();
	});

	it('arrows through a late-arriving control in the place it appears on screen', async () => {
		const user = userEvent.setup();
		const { activate, preview, checkbox, lastButton } = renderBar();

		await user.click(activate());

		// Controls register themselves as they mount, so the extension's checkbox registers last
		// even though it sits in the middle of the bar. Arrowing right from the first control has
		// to reach it before the right-hand button, or it can only be reached by arrowing past
		// every other control.
		preview().focus();
		await user.keyboard('{ArrowRight}');
		expect(checkbox()).toHaveFocus();

		await user.keyboard('{ArrowRight}');
		expect(lastButton()).toHaveFocus();
	});
});
