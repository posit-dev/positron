/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { TwoButtonFooter } from '../../components/twoButtonFooter.js';

describe('TwoButtonFooter', () => {
	const rtl = setupRTLRenderer();

	function renderFooter(primaryButtonDisabled: boolean) {
		const onPrimaryButton = vi.fn();
		rtl.render(
			<TwoButtonFooter
				primaryButtonDisabled={primaryButtonDisabled}
				primaryButtonTitle='Import'
				secondaryButtonTitle='Cancel'
				onPrimaryButton={onPrimaryButton}
				onSecondaryButton={vi.fn()}
			/>
		);

		return { onPrimaryButton, primaryButton: screen.getByRole('button', { name: 'Import' }) };
	}

	it('announces a disabled primary button without dropping it from the tab order', () => {
		const { primaryButton } = renderFooter(true);

		expect(primaryButton).toHaveAttribute('aria-disabled', 'true');
		// The dimmed styling in positronDynamicModalDialog.css hangs off this class, which is the
		// only thing that renders an aria-disabled button as unavailable.
		expect(primaryButton).toHaveClass('disabled');
		// Not natively disabled, so it stays reachable: a screen reader user can tab to it and be
		// told why it is unavailable, rather than never finding it.
		expect(primaryButton).toBeEnabled();
		expect(primaryButton).toHaveAttribute('tabIndex', '0');
		expect(primaryButton).toHaveFocus();
	});

	it('does not run the primary action while the primary button is disabled', async () => {
		const user = userEvent.setup();
		const { onPrimaryButton, primaryButton } = renderFooter(true);

		await user.click(primaryButton);

		expect(onPrimaryButton).not.toHaveBeenCalled();
	});

	it('runs the primary action when the primary button is enabled', async () => {
		const user = userEvent.setup();
		const { onPrimaryButton, primaryButton } = renderFooter(false);

		await user.click(primaryButton);

		expect(onPrimaryButton).toHaveBeenCalledOnce();
	});
});
