/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
	enableDataConnections: true,
});

const connectionName = 'orders';

// Tables in the order_tracking database.
const tables = [
	'categories', 'customers', 'order_items', 'orders',
	'payments', 'products', 'shipments', 'suppliers',
];

// Views in the order_tracking database.
const views = [
	'v_customer_ltv', 'v_order_totals', 'v_pending_fulfillment', 'v_product_sales',
];

// Tables in the order_tracking database used to verify columns and indexes.
// Using a single table avoids ambiguous 'Columns'/'Indexes' locator matches that arise
// when two tables are expanded simultaneously.
const detailTable = 'customers';
const detailColumns = [
	{ name: 'customer_id', dataType: 'INTEGER' },
	{ name: 'first_name', dataType: 'TEXT' },
	{ name: 'last_name', dataType: 'TEXT' },
	{ name: 'email', dataType: 'TEXT' },
	{ name: 'phone', dataType: 'TEXT' },
	{ name: 'city', dataType: 'TEXT' },
	{ name: 'state', dataType: 'TEXT' },
	{ name: 'country', dataType: 'TEXT' },
	{ name: 'created_at', dataType: 'TEXT' },
];
const detailIndexes = ['idx_customers_country'];

// The slice of the positronDataConnections.getConnections payload these tests validate. Mirrors
// IDataConnectionsGetConnectionsResult (positronDataConnectionsCommands.ts).
interface ConnectionsPayloadEntry {
	profileId: string;
	connected: boolean;
	summary: string;
}

// The slice of the positronDataConnections.getConnectionCode payload these tests validate. Mirrors
// IDataConnectionCodeResult (positronDataConnectionsCommands.ts).
interface ConnectionCodePayload {
	languages: Record<string, { code: string }>;
}

// The slice of the positronDataConnections.getSchema payload these tests validate. Mirrors
// IDataConnectionSchemaSummary (dataConnectionSchemaSummary.ts).
interface SchemaSummaryPayload {
	lines: string[];
	truncated: boolean;
}

/**
 * Reads the JSON payload out of the untitled editor a "Show ... as JSON" command opened.
 * Select-all + copy is deliberate: Monaco virtualizes rendered lines, so scraping the editor DOM
 * would truncate any payload taller than the viewport, while the clipboard sees the whole buffer.
 * The whole read retries so a copy that fires before the editor has focus can't strand the test.
 */
async function readActiveUntitledJson(app: Application): Promise<unknown> {
	const { clipboard, editors, hotKeys } = app.workbench;

	// The command opens the payload in a new dirty untitled editor.
	await editors.waitForActiveTab(/^Untitled-\d+$/, true);

	let payload: unknown;
	await expect(async () => {
		await hotKeys.selectAll();
		await clipboard.copy();
		payload = JSON.parse(await clipboard.getClipboardText() ?? '');
	}).toPass();
	return payload;
}

test.describe('Data Connections - SQLite', {
	tag: [tags.WEB, tags.WIN, tags.CONNECTIONS, tags.WORKBENCH]
}, () => {

	// SQLite connections are file-backed and stateful. Configure once and reuse across the
	// worker-scoped app. afterEach closes any open Data Explorer tab so each test starts clean.
	test.beforeAll(async function ({ app }) {
		const { dataConnections } = app.workbench;

		// The order_tracking.db file lives inside test-files, which is the workspace root.
		const databaseFile = join(app.workspacePathOrFolder, 'data-files/order-tracking/order_tracking.db');

		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('SQLite');

		await dataConnections.fillConnectionInputs({
			'Connection Name': connectionName,
			'Database File': databaseFile,
		});

		await dataConnections.save();
		await dataConnections.expectConnectionInTree(connectionName);

		await test.step('Expand the tree down to tables and views', async () => {
			await dataConnections.expandConnection(connectionName);
			await dataConnections.expandNode('Tables');
			await dataConnections.expandNode('Views');
		});
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.hotKeys.closeAllEditors();
	});

	test('Displays tables, views, columns, and indexes in the tree', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await test.step('Verify all tables and views are visible', async () => {
			for (const table of tables) {
				await dataConnections.expectNodeVisible(table);
			}
			for (const view of views) {
				await dataConnections.expectNodeVisible(view);
			}
		});

		await test.step('Verify columns and indexes for the customers table', async () => {
			await dataConnections.expandNode(detailTable);
			await dataConnections.expandNode('Columns');
			for (const { name, dataType } of detailColumns) {
				await dataConnections.expectColumn(name, dataType);
			}
			await dataConnections.expandNode('Indexes');
			for (const index of detailIndexes) {
				await dataConnections.expectNodeVisible(index);
			}
		});
	});

	test('Opens a table in the Data Explorer on double-click', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.doubleClickNode(detailTable);

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(detailColumns.map(({ name }) => name));
	});

	test('Opens a column in the Data Explorer on double-click', { tag: [tags.DATA_EXPLORER] }, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await dataConnections.expandNode(detailTable);
		await dataConnections.expandNode('Columns');

		await dataConnections.doubleClickNode('first_name');

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(['first_name']);
	});

	test('Remembers the preferred code variant when reopening Connect With', async function ({ app }) {
		const { dataConnections } = app.workbench;

		await test.step('Select a non-default variant', async () => {
			await dataConnections.openConnectWith(connectionName, 'Python');
			await dataConnections.expectConnectionCodeVariantSelected('sqlite3');
			await dataConnections.selectConnectionCodeVariant('SQLAlchemy');
			await dataConnections.expectConnectionCodeVariantSelected('SQLAlchemy');
			await dataConnections.closeConnectWith();
		});

		await test.step('Reopen Connect With and confirm the selection is remembered', async () => {
			await dataConnections.openConnectWith(connectionName, 'Python');
			await dataConnections.expectConnectionCodeVariantSelected('SQLAlchemy');
			await dataConnections.closeConnectWith();
		});
	});

	// The next three tests validate the JSON payloads Assistant consumes, via the Command Palette
	// commands that open them in an editor (positronDataConnectionsInspectActions.ts).

	test('Shows the connections payload as valid JSON', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('positronDataConnections.showConnections');

		const payload = await readActiveUntitledJson(app) as ConnectionsPayloadEntry[];

		expect(payload).toHaveLength(1);
		const [profile] = payload;
		expect(profile.profileId).toBeTruthy();
		expect(profile.connected).toBe(true);
		// Everything descriptive is one line rather than a field per fact; see
		// formatConnectionSummary (positronDataConnectionsCommands.ts) for the grammar. The
		// driver's id is reported, not its display name.
		expect(profile.summary).toContain(
			`name=${connectionName} | driver=positron-data-driver-sqlite | mechanism=file | languages=python, r | parameters=`);
		// The driver's parameters nest inside the single parameters= field. Matched rather than
		// compared whole: the path is absolute, so it differs per machine and per platform.
		expect(profile.summary).toMatch(/databasePath=[^,|]*order_tracking\.db/);
	});

	test('Shows the connection code as valid JSON', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('positronDataConnections.showConnectionCode');

		const payload = await readActiveUntitledJson(app) as ConnectionCodePayload;

		// One code snippet per supported language, each referencing the database file. The variant
		// is not asserted: another test changes the preferred Python variant, and the payload
		// reflects that preference.
		expect(payload.languages.python.code).toContain('order_tracking.db');
		expect(payload.languages.r.code).toContain('order_tracking.db');
	});

	test('Shows the schema summary as valid JSON', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('positronDataConnections.showSchema');

		const summary = await readActiveUntitledJson(app) as SchemaSummaryPayload;

		// The summary is one line per object -- `<path> [<kind>][ (<column>:<type>[ PK], ...)]`,
		// see renderSchemaLines (dataConnectionSchemaSummary.ts). Group nodes ("Tables", "Views",
		// "Columns", "Indexes") are flattened out, so tables and views are named at the root and a
		// table's indexes get lines of their own beneath it. The database is small enough that
		// nothing should be truncated.
		expect(summary.truncated).toBe(false);
		expect(summary.lines).toEqual(expect.arrayContaining([
			...tables.map(table => expect.stringMatching(new RegExp(`^${table} \\[table\\]`))),
			...views.map(view => expect.stringMatching(new RegExp(`^${view} \\[view\\]`))),
			...detailIndexes.map(index =>
				expect.stringMatching(new RegExp(`^${detailTable}\\.${index} \\[index\\]`))),
		]));

		// Columns are folded onto their table's line, each carrying its data type through.
		const detailLine = summary.lines.find(line => line.startsWith(`${detailTable} [`));
		for (const { name, dataType } of detailColumns) {
			expect(detailLine).toContain(`${name}:${dataType}`);
		}
	});
});
