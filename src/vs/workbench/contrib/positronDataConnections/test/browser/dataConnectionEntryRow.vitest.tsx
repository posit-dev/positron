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
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IDataConnectionDriver, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionEntryRow } from '../../browser/components/dataConnectionEntryRow.js';

// showCustomContextMenu renders a modal popup into the workbench DOM, which isn't what these tests
// are about -- the behavior under test is which entries the row decides to offer. Mocking the one
// module lets us read the entries straight off the call.
const { showCustomContextMenu } = vi.hoisted(() => ({ showCustomContextMenu: vi.fn() }));
vi.mock('../../../../browser/positronComponents/customContextMenu/customContextMenu.js', () => ({
	showCustomContextMenu,
}));

const profile: IDataConnectionProfile = {
	id: 'conn-1',
	driverMetadata: {
		id: 'test-driver',
		name: 'Test Driver',
		iconSvg: '',
		supportedLanguageIds: [],
	},
	connectionName: 'My Connection',
	mechanismId: 'test-mechanism',
	parameterValues: {},
};

// The row needs its driver to build a menu at all. This one supports no languages, so the menu
// leaves out the Connect With group and the entries under test stand alone.
const driver = stubInterface<IDataConnectionDriver>({
	id: 'test-driver',
	metadata: {
		id: 'test-driver',
		name: 'Test Driver',
		description: '',
		iconSvg: '',
		mechanisms: [{ id: 'test-mechanism', label: 'Test Mechanism', description: '', parameters: [] }],
		supportedLanguageIds: [],
	},
});

describe('DataConnectionEntryRow', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronDataConnectionsService, {
			driverManager: stubInterface<IDataConnectionsDriverManager>({ getDriver: () => driver }),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// The tree supplies these; the indicator tests don't exercise either.
	const onDisconnect = vi.fn();
	const onRefresh = vi.fn();
	const onMenuOpening = vi.fn((): IDisposable => ({ dispose: vi.fn() }));

	/**
	 * Renders a row -- connected unless told otherwise -- and right-clicks it. Returns the row's
	 * callbacks, the menu call, and the labels of the entries the row offered ('---' for a separator).
	 */
	async function rightClickRow(connected = true) {
		const instance = connected
			? stubInterface<IDataConnectionInstance>({ id: 'instance-1', profileId: profile.id })
			: undefined;
		const onDisconnectRow = vi.fn();

		rtl.render(
			<DataConnectionEntryRow
				entry={{ profile, instance }}
				onDisconnect={onDisconnectRow}
				onMenuOpening={onMenuOpening}
				onRefresh={onRefresh}
			/>
		);

		const user = userEvent.setup();
		// The row is a structural div with no role or label, so target its name instead -- pointer
		// events there bubble up to the row's handlers, which is what a real click does too.
		await user.pointer({ keys: '[MouseRight]', target: screen.getByText('My Connection', { exact: false }) });

		const call = showCustomContextMenu.mock.calls.at(-1)?.[0];
		const items: CustomContextMenuItem[] = call?.entries.filter(
			(entry: unknown) => entry instanceof CustomContextMenuItem
		);
		const labels = call?.entries.map((entry: unknown) =>
			entry instanceof CustomContextMenuSeparator ? '---' : (entry as CustomContextMenuItem).options.label
		);

		// Items are located by label rather than index, so a menu the row grows another entry in
		// doesn't move the one under test out from under the assertion.
		const itemByLabel = (label: string) => items.find(item => item.options.label === label);

		return { labels, itemByLabel, onDisconnectRow };
	}

	it('shows the connected indicator for a profile with a live connection', () => {
		const instance = stubInterface<IDataConnectionInstance>({ id: 'instance-1', profileId: profile.id });

		rtl.render(<DataConnectionEntryRow entry={{ profile, instance }} onDisconnect={onDisconnect} onMenuOpening={onMenuOpening} onRefresh={onRefresh} />);

		// The indicator is a bare dot, so its accessible name is the only thing to query it by.
		expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument();
	});

	it('shows no connected indicator for a saved profile that is not connected', () => {
		rtl.render(<DataConnectionEntryRow entry={{ profile }} onDisconnect={onDisconnect} onMenuOpening={onMenuOpening} onRefresh={onRefresh} />);

		expect(screen.queryByRole('img', { name: 'Connected' })).not.toBeInTheDocument();
		expect(screen.getByText('My Connection', { exact: false })).toBeInTheDocument();
	});

	it('offers Disconnect above Remove for a connected profile', async () => {
		const { labels } = await rightClickRow();

		expect(labels).toMatchInlineSnapshot(`
			[
			  "Refresh",
			  "---",
			  "Edit Connection",
			  "---",
			  "Disconnect",
			  "Remove",
			]
		`);
	});

	// Nothing to close on a saved-but-closed profile, so the item would be dead weight.
	it('offers no Disconnect for a profile that is not connected', async () => {
		const { labels } = await rightClickRow(false);

		expect(labels).toMatchInlineSnapshot(`
			[
			  "Refresh",
			  "---",
			  "Edit Connection",
			  "---",
			  "Remove",
			]
		`);
	});

	it('invokes the tree-supplied disconnect when Disconnect is selected', async () => {
		const { itemByLabel, onDisconnectRow } = await rightClickRow();

		itemByLabel('Disconnect')?.options.onSelected({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });

		// The tree owns what disconnecting means -- closing the connection's Data Explorers and
		// collapsing the row -- so the row's job is done once it has handed the request over.
		expect(onDisconnectRow).toHaveBeenCalledOnce();
	});

	// Disconnect shares the bottom group with Remove but not its styling: giving up a connection
	// leaves the saved profile intact, so nothing about it is unrecoverable.
	it('marks Remove destructive but not Disconnect', async () => {
		const { itemByLabel } = await rightClickRow();

		expect({
			disconnect: itemByLabel('Disconnect')?.options.destructive,
			remove: itemByLabel('Remove')?.options.destructive,
		}).toMatchInlineSnapshot(`
			{
			  "disconnect": undefined,
			  "remove": true,
			}
		`);
	});
});
