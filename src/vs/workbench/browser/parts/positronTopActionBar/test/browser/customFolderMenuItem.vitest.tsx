/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { CustomFolderMenuItem } from '../../customFolderModalPopup/customFolderMenuItem.js';

describe('CustomFolderMenuItem', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('runs its command when enabled', async () => {
		const user = userEvent.setup();
		const onSelected = vi.fn();
		rtl.render(<CustomFolderMenuItem enabled label='New Folder from Git...' onSelected={onSelected} />);

		await user.click(screen.getByRole('button', { name: 'New Folder from Git...' }));

		expect(onSelected).toHaveBeenCalled();
	});

	it('does not run its command when its precondition does not hold', async () => {
		const user = userEvent.setup();
		const onSelected = vi.fn();
		rtl.render(<CustomFolderMenuItem enabled={false} label='New Folder from Git...' onSelected={onSelected} />);

		const item = screen.getByRole('button', { name: 'New Folder from Git...' });
		await user.click(item);

		expect(onSelected).not.toHaveBeenCalled();
		expect(item).toHaveAttribute('aria-disabled', 'true');
	});
});
