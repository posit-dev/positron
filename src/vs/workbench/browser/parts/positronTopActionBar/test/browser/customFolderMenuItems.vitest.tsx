/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, within } from '@testing-library/react';
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
	const onMenuItemSelected = vi.fn();

	function renderMenu(...folders: IRecentFolder[]) {
		return rtl.render(
			<CustomFolderMenuItems
				recentlyOpened={{ workspaces: folders, files: [] }}
				onMenuItemSelected={onMenuItemSelected}
			/>
		);
	}

	it('pins a folder without opening it or closing the menu', async () => {
		const user = userEvent.setup();
		const openWindow = vi.spyOn(ctx.reactServices.hostService, 'openWindow');
		renderMenu(recentFolder('a'), recentFolder('b'));

		await user.click(screen.getByRole('button', { name: 'Pin project-a' }));
		act(() => screen.getByRole('button', { name: 'Pin project-b' }).focus());
		await user.keyboard('{Enter}');

		expect(onMenuItemSelected).not.toHaveBeenCalled();
		expect(openWindow).not.toHaveBeenCalled();

		// Opening the folder from its row does both.
		await user.click(screen.getByRole('button', { name: 'project-a' }));

		expect(onMenuItemSelected).toHaveBeenCalledOnce();
		expect(openWindow).toHaveBeenCalledOnce();
	});

	it('moves a pinned folder to the top of the menu', async () => {
		const user = userEvent.setup();
		renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));

		await user.click(within(folderRows()[2]).getByRole('button', { name: 'Pin project-c' }));

		const rows = folderRows();
		expect(rows.map(row => row.textContent)).toEqual(['project-c', 'project-a', 'project-b']);
		expect(within(rows[0]).getByRole('button', { name: 'Unpin project-c' })).toBeInTheDocument();
	});

	it('keeps a pinned folder the next time the menu opens, even once it leaves the recent list', async () => {
		const user = userEvent.setup();
		const { unmount } = renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));
		await user.click(within(folderRows()[2]).getByRole('button', { name: 'Pin project-c' }));
		unmount();

		renderMenu(recentFolder('a'), recentFolder('b'));

		expect(folderRows().map(row => row.textContent)).toEqual(['project-c', 'project-a', 'project-b']);
	});

	it('keeps a folder pinned in another window when this window pins a folder', async () => {
		const user = userEvent.setup();
		const firstWindow = renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));
		const secondWindow = renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));
		const rowsIn = (window: typeof firstWindow) =>
			within(window.container).getAllByRole('button', { name: /^project-/ });

		await user.click(within(rowsIn(secondWindow)[1]).getByRole('button', { name: 'Pin project-b' }));
		await user.click(within(rowsIn(firstWindow)[2]).getByRole('button', { name: 'Pin project-c' }));
		firstWindow.unmount();
		secondWindow.unmount();

		renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));

		expect(folderRows().map(row => row.textContent)).toEqual(['project-b', 'project-c', 'project-a']);
	});

	it('keeps keyboard focus on the pin button of a folder as it moves', async () => {
		const user = userEvent.setup();
		renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));

		act(() => screen.getByRole('button', { name: 'Pin project-c' }).focus());
		await user.keyboard('{Enter}');
		expect(screen.getByRole('button', { name: 'Unpin project-c' })).toHaveFocus();

		await user.keyboard('{Enter}');
		expect(screen.getByRole('button', { name: 'Pin project-c' })).toHaveFocus();
	});

	it('returns an unpinned folder to its place in the recent list', async () => {
		const user = userEvent.setup();
		renderMenu(recentFolder('a'), recentFolder('b'), recentFolder('c'));
		await user.click(within(folderRows()[1]).getByRole('button', { name: 'Pin project-b' }));

		await user.click(within(folderRows()[0]).getByRole('button', { name: 'Unpin project-b' }));

		expect(folderRows().map(row => row.textContent)).toEqual(['project-a', 'project-b', 'project-c']);
	});
});
