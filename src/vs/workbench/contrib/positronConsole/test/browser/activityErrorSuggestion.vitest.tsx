/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ActivityErrorSuggestion } from '../../browser/components/activityErrorSuggestion.js';
import { ActivityItemErrorSuggestion } from '../../../../services/positronConsole/browser/classes/activityItemErrorSuggestion.js';

describe('ActivityErrorSuggestion', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function makeItem(run: () => Promise<void>): ActivityItemErrorSuggestion {
		return new ActivityItemErrorSuggestion('id', 'parent', new Date(), [
			{ icon: Codicon.lightBulb, label: 'Install requests', run },
		]);
	}

	it('renders the yellow gutter, a lightbulb, and runs the action on click', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const { container } = rtl.render(<ActivityErrorSuggestion activityItemErrorSuggestion={makeItem(run)} />);

		// The yellow gutter is a structural element with no role/text; assert via testid.
		expect(screen.getByTestId('error-suggestion-bar')).toBeInTheDocument();

		// The lightbulb icon is rendered via the suggestion's ThemeIcon class.
		// eslint-disable-next-line no-restricted-syntax -- structural icon span has no role/text/testid
		expect(container.querySelector(`.${ThemeIcon.asClassName(Codicon.lightBulb).split(' ').join('.')}`)).toBeInTheDocument();

		const user = userEvent.setup();
		await user.click(screen.getByText('Install requests'));

		expect(run).toHaveBeenCalledTimes(1);
	});

	it('re-enables the action after a failing run instead of leaking a rejection', async () => {
		// A run that rejects must not leave the button stuck disabled, and must be
		// caught so it does not escape as an unhandled promise rejection.
		const run = vi.fn().mockRejectedValue(new Error('install failed'));
		rtl.render(<ActivityErrorSuggestion activityItemErrorSuggestion={makeItem(run)} />);

		const user = userEvent.setup();
		const button = screen.getByText('Install requests');
		await user.click(button);

		expect(run).toHaveBeenCalledTimes(1);
		// The button resets so the user can retry.
		await waitFor(() => expect(screen.getByText('Install requests').closest('button')).toBeEnabled());
	});
});
