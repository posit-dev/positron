/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../../base/common/uri.js';
import { IRecentFolder } from '../../../../../../platform/workspaces/common/workspaces.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { CustomFolderMenuItems } from '../../customFolderModalPopup/customFolderMenuItems.js';

/**
 * Creates a recent folder with an explicit label, so the rendered label doesn't
 * depend on the label service.
 */
function recentFolder(name: string): IRecentFolder {
	return { folderUri: URI.file(`/projects/${name}`), label: `project-${name}` };
}

/**
 * Gets the folder rows, in display order.
 */
function folderRows() {
	return screen.getAllByRole('button', { name: /^project-/ });
}

describe('CustomFolderMenuItems', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderMenu(...folders: IRecentFolder[]) {
		return rtl.render(
			<CustomFolderMenuItems
				recentlyOpened={{ workspaces: folders, files: [] }}
				onMenuItemSelected={() => { }}
			/>
		);
	}

	it('moves a pinned folder to the top of the menu', async () => {
		const user = userEvent.setup();
		renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));

		await user.click(within(folderRows()[2]).getByRole('button', { name: 'Pin' }));

		const rows = folderRows();
		expect(rows.map(row => row.textContent)).toEqual(['project-c', 'project-a', 'project-b']);
		expect(within(rows[0]).getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
	});

	it('keeps a pinned folder the next time the menu opens, even once it leaves the recent list', async () => {
		const user = userEvent.setup();
		const { unmount } = renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));
		await user.click(within(folderRows()[2]).getByRole('button', { name: 'Pin' }));
		unmount();

		renderMenu(recentFolder('a'), recentFolder('b'));

		expect(folderRows().map(row => row.textContent)).toEqual(['project-c', 'project-a', 'project-b']);
	});

	it('returns an unpinned folder to its place in the recent list', async () => {
		const user = userEvent.setup();
		renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));
		await user.click(within(folderRows()[1]).getByRole('button', { name: 'Pin' }));

		await user.click(within(folderRows()[0]).getByRole('button', { name: 'Unpin' }));

		expect(folderRows().map(row => row.textContent)).toEqual(['project-a', 'project-b', 'project-c']);
	});
});
