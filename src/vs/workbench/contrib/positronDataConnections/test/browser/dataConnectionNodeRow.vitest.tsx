/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { IDataConnectionHandle } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionNodeRow } from '../../browser/components/dataConnectionNodeRow.js';

// showCustomContextMenu renders a modal popup into the workbench DOM, which isn't what these tests
// are about -- the behavior under test is which entries the row decides to offer, and whether it
// opens a menu at all. Mocking the one module lets us read the entries straight off the call.
const { showCustomContextMenu } = vi.hoisted(() => ({ showCustomContextMenu: vi.fn() }));
vi.mock('../../../../browser/positronComponents/customContextMenu/customContextMenu.js', () => ({
	showCustomContextMenu,
}));

describe('DataConnectionNodeRow', () => {
	// The row previews through the service rather than the handle, so the connection can record the
	// Data Explorer it opened.
	const previewNode = vi.fn().mockResolvedValue(undefined);
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronDataConnectionsService, { previewNode })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function createDto(overrides: Partial<IDataConnectionNodeDTO> = {}): IDataConnectionNodeDTO {
		return {
			nodeHandle: 1,
			name: 'users',
			kind: 'table',
			hasGetChildren: false,
			hasPreview: true,
			...overrides,
		};
	}

	/**
	 * Renders a row and right-clicks it. Returns the row's connection handle, its callbacks, and the
	 * labels of the menu entries the row offered ('---' for a separator), or undefined when the row
	 * declined to open a menu at all.
	 */
	async function rightClickRow(dto: IDataConnectionNodeDTO, stale = false) {
		const handle = stubInterface<IDataConnectionHandle>({ handle: 1 });
		const onRefresh = vi.fn();
		const disposeHold = vi.fn();
		// A plain IDisposable rather than toDisposable(), so the tracker doesn't count the tests
		// that deliberately never close the menu as leaks.
		const onMenuOpening = vi.fn((): IDisposable => ({ dispose: disposeHold }));

		rtl.render(
			<DataConnectionNodeRow
				dto={dto}
				handle={handle}
				stale={stale}
				onMenuOpening={onMenuOpening}
				onRefresh={onRefresh}
			/>
		);

		const user = userEvent.setup();
		// The row itself is a structural div with no role or label, so target its name instead --
		// pointer events there bubble up to the row's handlers, which is what a real click does too.
		const rowText = screen.getByText(dto.name);
		await user.pointer({ keys: '[MouseRight]', target: rowText });

		const call = showCustomContextMenu.mock.calls.at(-1)?.[0];
		const labels = call?.entries.map((entry: unknown) =>
			entry instanceof CustomContextMenuSeparator ? '---' : (entry as { options: { label: string } }).options.label
		);

		return { labels, call, rowText, user, handle, onRefresh, onMenuOpening, disposeHold };
	}

	it('offers Refresh above Open in Data Explorer for a previewable node with children', async () => {
		const { labels } = await rightClickRow(createDto({ hasGetChildren: true, hasPreview: true }));

		expect(labels).toMatchInlineSnapshot(`
			[
			  "Refresh",
			  "---",
			  "Open in Data Explorer",
			]
		`);
	});

	it('offers only Refresh for a node that has children but no preview', async () => {
		const { labels } = await rightClickRow(
			createDto({ kind: 'schema', name: 'public', hasGetChildren: true, hasPreview: false })
		);

		expect(labels).toMatchInlineSnapshot(`
			[
			  "Refresh",
			]
		`);
	});

	it('offers only Open in Data Explorer for a previewable leaf', async () => {
		const { labels } = await rightClickRow(createDto({ hasGetChildren: false, hasPreview: true }));

		expect(labels).toMatchInlineSnapshot(`
			[
			  "Open in Data Explorer",
			]
		`);
	});

	it('opens no menu for a leaf with nothing to offer, leaving the event alone', async () => {
		const { labels, onMenuOpening } = await rightClickRow(
			createDto({ kind: 'column', name: 'id', hasGetChildren: false, hasPreview: false })
		);

		// No menu, and no focus hold taken -- an empty menu would be worse than none, and holding
		// the tree's focused appearance for a menu that never opened would never be released.
		expect({ labels, heldFocus: onMenuOpening.mock.calls.length }).toMatchInlineSnapshot(`
			{
			  "heldFocus": 0,
			  "labels": undefined,
			}
		`);
	});

	// The safety property: a stale row's node handle may already have been released by the
	// ancestor's refresh, so acting on it would hit a dead handle.
	it('offers nothing on a stale row, even when actions would otherwise apply', async () => {
		const { labels, onMenuOpening } = await rightClickRow(
			createDto({ hasGetChildren: true, hasPreview: true }),
			true
		);

		expect({ labels, heldFocus: onMenuOpening.mock.calls.length }).toMatchInlineSnapshot(`
			{
			  "heldFocus": 0,
			  "labels": undefined,
			}
		`);
	});

	it('does not open a preview when a stale row is double-clicked', async () => {
		const { rowText, user } = await rightClickRow(createDto({ hasPreview: true }), true);

		await user.dblClick(rowText);

		expect(previewNode).not.toHaveBeenCalled();
	});

	it('opens a preview when a previewable row is double-clicked', async () => {
		const { rowText, user, handle } = await rightClickRow(createDto({ nodeHandle: 42, hasPreview: true }));

		await user.dblClick(rowText);

		expect(previewNode).toHaveBeenCalledWith(handle, 42);
	});

	it('holds the tree focused while the menu is open and releases the hold when it closes', async () => {
		const { call, onMenuOpening, disposeHold } = await rightClickRow(
			createDto({ hasGetChildren: true })
		);

		const heldBeforeClose = disposeHold.mock.calls.length;
		call.onClose();

		expect({
			heldFocus: onMenuOpening.mock.calls.length,
			heldBeforeClose,
			releasedAfterClose: disposeHold.mock.calls.length,
		}).toMatchInlineSnapshot(`
			{
			  "heldBeforeClose": 0,
			  "heldFocus": 1,
			  "releasedAfterClose": 1,
			}
		`);
	});

	it('invokes the tree-supplied reload when Refresh is selected', async () => {
		const { call, onRefresh } = await rightClickRow(createDto({ hasGetChildren: true }));

		call.entries[0].options.onSelected();

		expect(onRefresh).toHaveBeenCalledOnce();
	});

	it('anchors the menu at the pointer rather than the row edge', async () => {
		const { call } = await rightClickRow(createDto({ hasGetChildren: true }));

		expect(call.anchorPoint).toEqual({ clientX: expect.any(Number), clientY: expect.any(Number) });
	});
});
