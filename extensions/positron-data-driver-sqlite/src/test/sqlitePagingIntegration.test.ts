/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import Database from 'better-sqlite3';
import { createSqliteReadPlan } from '../sqliteReadPlan.js';
import { buildSqliteSchema } from '../sqliteDataExplorerRpcHandler.js';
import { SqliteTableView } from '../sqliteTableView.js';
import { SqliteWorkerClient } from '../sqliteWorkerClient.js';
import { ColumnDisplayType, FormatOptions, TableSelectionKind } from 'positron-data-explorer-protocol';

/**
 * The read path exercised against a real SQLite file through the real worker, rather than a fake
 * that answers whatever SQL it is handed.
 *
 * `sqlitePaging.test.ts` covers which SQL the driver emits and that paging it partitions the rows.
 * It cannot tell whether SQLite and better-sqlite3 will actually accept that SQL -- and they did
 * not: the worker ran every statement through `all()`, which throws "This statement does not return
 * data. Use run() instead" on the CREATE that materializes a view's snapshot, so opening any view
 * failed outright. These tests close that gap.
 */
suite('SQLite paging integration Tests', () => {
	const FORMAT: FormatOptions = {
		large_num_digits: 2,
		small_num_digits: 4,
		max_integral_digits: 7,
		max_value_length: 100,
	};

	const ROWS = 1000;
	const PAGE = 50;

	let tmpDir: string;
	const clients: SqliteWorkerClient[] = [];

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-sqlite-paging-'));
	});

	teardown(() => {
		for (const client of clients.splice(0)) {
			client.dispose();
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	/** Builds a database holding each relation shape the read plan has to handle. */
	function createTestDb(name: string): string {
		const dbPath = path.join(tmpDir, name);
		const db = new Database(dbPath);
		db.exec(`
			CREATE TABLE t (id INTEGER PRIMARY KEY, k INTEGER, payload TEXT);
			CREATE TABLE dim (k INTEGER PRIMARY KEY, nm TEXT);
			CREATE VIEW v AS SELECT t.id, dim.nm FROM t JOIN dim ON dim.k = t.k;
			CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER) WITHOUT ROWID;
			CREATE TABLE decoy (id TEXT PRIMARY KEY, note TEXT DEFAULT 'migrated without rowid');
		`);
		const insertT = db.prepare('INSERT INTO t VALUES (?, ?, ?)');
		const insertKv = db.prepare('INSERT INTO kv VALUES (?, ?)');
		const insertDim = db.prepare('INSERT INTO dim VALUES (?, ?)');
		const insertDecoy = db.prepare('INSERT INTO decoy VALUES (?, ?)');
		db.transaction(() => {
			for (let i = 1; i <= ROWS; i++) {
				insertT.run(i, i % 100, `p${i}`);
				insertKv.run(`k${i}`, i);
				insertDecoy.run(`d${i}`, 'x');
			}
			for (let i = 0; i < 100; i++) {
				insertDim.run(i, `n${i}`);
			}
		})();
		db.close();
		return dbPath;
	}

	function openClient(dbPath: string, readOnly = false): SqliteWorkerClient {
		const client = new SqliteWorkerClient({ databasePath: dbPath, readOnly });
		clients.push(client);
		return client;
	}

	/** Builds a table view over a relation exactly as the RPC handler does. */
	async function openView(
		client: SqliteWorkerClient,
		relation: string,
		kind: 'table' | 'view',
	): Promise<SqliteTableView> {
		const schema = await buildSqliteSchema(client, relation);
		const readPlan = await createSqliteReadPlan(
			client, relation, kind, schema.map(c => c.column_name));
		return new SqliteTableView(client, relation, readPlan, schema);
	}

	/** Pages the whole relation and reports the first column's values, in page order. */
	async function sweep(view: SqliteTableView, total: number): Promise<Array<string | number>> {
		const values: Array<string | number> = [];
		for (let offset = 0; offset < total; offset += PAGE) {
			const page = await view.getDataValues({
				columns: [{ column_index: 0, spec: { first_index: offset, last_index: offset + PAGE - 1 } }],
				format_options: FORMAT,
			});
			values.push(...page.columns[0] as Array<string | number>);
		}
		return values;
	}

	test('a table pages exactly once per row', async () => {
		const client = openClient(createTestDb('table.db'));
		const view = await openView(client, 't', 'table');

		const values = await sweep(view, ROWS);

		assert.deepStrictEqual(
			{ count: values.length, distinct: new Set(values).size },
			{ count: ROWS, distinct: ROWS });
	});

	test('a view opens and pages exactly once per row', async () => {
		// The case that failed in the product: materializing the snapshot needs a statement that
		// returns no rows, and the worker rejected those.
		const client = openClient(createTestDb('view.db'));
		const view = await openView(client, 'v', 'view');

		const state = await view.getState();
		const values = await sweep(view, state.table_shape.num_rows);

		assert.deepStrictEqual(
			{ rows: state.table_shape.num_rows, count: values.length, distinct: new Set(values).size },
			{ rows: ROWS, count: ROWS, distinct: ROWS });
	});

	test('a view opens and pages on a read-only database', async () => {
		// `temp` is a separate database that stays writable, so the snapshot is legal here -- but only
		// a real connection can confirm that better-sqlite3 agrees.
		const client = openClient(createTestDb('view-ro.db'), true);
		const view = await openView(client, 'v', 'view');

		const state = await view.getState();
		const values = await sweep(view, state.table_shape.num_rows);

		assert.deepStrictEqual(
			{ rows: state.table_shape.num_rows, distinct: new Set(values).size },
			{ rows: ROWS, distinct: ROWS });
	});

	test('a WITHOUT ROWID table pages exactly once per row', async () => {
		// Ordering this relation by `rowid` is a hard error, so it has to resolve to the primary key.
		const client = openClient(createTestDb('without-rowid.db'));
		const view = await openView(client, 'kv', 'table');

		const values = await sweep(view, ROWS);

		assert.deepStrictEqual(
			{ count: values.length, distinct: new Set(values).size },
			{ count: ROWS, distinct: ROWS });
	});

	test('a table whose DDL mentions the words WITHOUT ROWID still pages by rowid', async () => {
		// `decoy` is an ordinary table whose DEFAULT literal contains the words. Reading the stored
		// CREATE statement would misclassify it; probing cannot.
		const client = openClient(createTestDb('decoy.db'));
		// `decoy` is read in place, so the column list the snapshot path would consult is not involved.
		const plan = await createSqliteReadPlan(client, 'decoy', 'table', []);
		const view = await openView(client, 'decoy', 'table');

		const values = await sweep(view, ROWS);

		assert.deepStrictEqual(
			{ rowOrder: plan.rowOrder, distinct: new Set(values).size },
			{ rowOrder: 'rowid', distinct: ROWS });
	});

	test('an index-based export returns the rows shown at those positions', async () => {
		const client = openClient(createTestDb('export.db'));
		const view = await openView(client, 'v', 'view');

		const displayed = await sweep(view, ROWS);
		const positions = [0, 1, 49, 50, 517, ROWS - 1];
		const exported = await view.exportDataSelection({
			selection: { kind: TableSelectionKind.RowIndices, selection: { indices: positions } },
			format: 'csv' as never,
		});
		// The CSV carries a header row, then one line per requested position, in request order.
		const exportedFirstColumn = exported.data.trim().split('\n').slice(1)
			.map(line => line.split(',')[0]);

		assert.deepStrictEqual(exportedFirstColumn, positions.map(p => String(displayed[p])));
	});

	test('the snapshot is dropped when the view is disposed', async () => {
		const client = openClient(createTestDb('dispose.db'));
		const view = await openView(client, 'v', 'view');
		await view.getState();

		const before = await client.runQuery(
			`SELECT count(*) AS n FROM temp.sqlite_master WHERE type = 'table'`);
		await view.dispose();
		const after = await client.runQuery(
			`SELECT count(*) AS n FROM temp.sqlite_master WHERE type = 'table'`);

		assert.deepStrictEqual(
			{ before: Number(before[0].n), after: Number(after[0].n) },
			{ before: 1, after: 0 });
	});

	test('a column profile describes the same rows the grid shows', async () => {
		// Profiles run against the snapshot too, so a view's null count cannot be computed from a
		// different pass over the live view than the one the grid displayed.
		const client = openClient(createTestDb('profile.db'));
		const view = await openView(client, 'v', 'view');
		await view.getState();

		const profiles = await view.computeColumnProfiles({
			callback_id: 'c',
			profiles: [{ column_index: 0, profiles: [{ profile_type: 'null_count' as never }] }],
			format_options: FORMAT,
		});

		assert.strictEqual(profiles.profiles[0].null_count, 0);
	});

	test('display type mapping survives the round trip', async () => {
		// A guard that openView's schema and the read plan agree on column order, since the read plan
		// resolution and the schema build run concurrently.
		const client = openClient(createTestDb('schema.db'));
		const view = await openView(client, 't', 'table');

		const schema = await view.getSchema({ column_indices: [0, 1, 2] });

		assert.deepStrictEqual(
			schema.columns.map(c => [c.column_name, c.type_display]),
			[
				['id', ColumnDisplayType.Integer],
				['k', ColumnDisplayType.Integer],
				['payload', ColumnDisplayType.String],
			]);
	});
});
