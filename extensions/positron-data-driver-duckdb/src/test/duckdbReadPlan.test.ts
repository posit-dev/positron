/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DuckDBRow, createDuckDBReadPlan } from 'positron-data-explorer-duckdb';

/** A fake client that records SQL and stands in for one DuckDB connection. */
class FakeClient {
	readonly queries: string[] = [];
	private _crashListener: (() => void) | undefined;

	async runQuery(sql: string, _params?: Record<string, string>): Promise<DuckDBRow[]> {
		this.queries.push(sql);
		return [];
	}

	/** Stands in for `DuckDBWorkerClient.onDidCrash`. */
	onDidCrash = (listener: () => void) => {
		this._crashListener = listener;
		return { dispose: () => { this._crashListener = undefined; } };
	};

	/** Simulates the worker dying and being replaced, which empties the `temp` catalog. */
	crash(): void {
		this._crashListener?.();
	}
}

suite('DuckDB read plan Tests', () => {
	test('a table is read in place, with rowid as its row order', async () => {
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."people"', 'table', ['id', 'label']);

		assert.deepStrictEqual(
			{ relation: await plan.relation(), rowOrder: plan.rowOrder, queries: client.queries },
			// Nothing is created and nothing is asked: a scan of a base table already comes back in
			// insertion order, so there is no setup to do.
			{ relation: '"main"."people"', rowOrder: 'rowid', queries: [] });
	});

	test('a table that declares a rowid column is snapshotted, not read in place', async () => {
		// The declared column shadows the table's real rowid, and DuckDB has no second spelling to reach
		// past it, so reading in place would order by user data: `('b',1),('a',2),('c',3)` displays 1, 2,
		// 3 in scan order while an export numbering by `rowid` returns 2, 1, 3. Snapshotting numbers the
		// rows in a column of the snapshot's own instead. Matched without regard to case, as DuckDB
		// resolves unquoted identifiers that way.
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."imported"', 'table', ['ROWID', 'v']);

		const relation = await plan.relation();

		assert.deepStrictEqual(
			{ rowOrder: plan.rowOrder, creates: client.queries },
			{
				rowOrder: '"__positron_row_order"',
				creates: [
					`CREATE TEMP TABLE ${relation.replace('temp.', '')} AS ` +
					`SELECT ROW_NUMBER() OVER () AS "__positron_row_order", * FROM "main"."imported"`,
				],
			});
	});

	test('a view is read through a snapshot, materialized once', async () => {
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."sales_by_region"', 'view', ['id', 'label']);

		// Nothing is created until the first read, so opening a view costs nothing extra.
		assert.deepStrictEqual(client.queries, []);

		const first = await plan.relation();
		const second = await plan.relation();

		assert.deepStrictEqual(
			{
				reusesOneSnapshot: first === second,
				readsFromTempCatalog: /^temp\."positron_snapshot_\d+"$/.test(first),
				rowOrder: plan.rowOrder,
				creates: client.queries,
			},
			{
				reusesOneSnapshot: true,
				readsFromTempCatalog: true,
				rowOrder: 'rowid',
				// Materialized exactly once, however many reads follow. The CREATE names the snapshot
				// unqualified, because DuckDB rejects a catalog-qualified name there.
				creates: [
					`CREATE TEMP TABLE ${first.replace('temp.', '')} AS SELECT * FROM "main"."sales_by_region"`,
				],
			});
	});

	test('a view that emits a rowid column is numbered explicitly, not ordered by that column', async () => {
		// `SELECT *` copies the view's columns verbatim, so a view emitting `rowid` puts a column of
		// that name into the snapshot, where it shadows the snapshot's own rowid. Ordering by the name
		// would then read the copied column, which carries no uniqueness once a join has fanned the
		// view out -- paging would drift again, and an index-based export would write rows the user
		// never selected. DuckDB has no second spelling of the rowid, so the rows get their own column.
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."v"', 'view', ['rowid', 'total']);

		const relation = await plan.relation();

		assert.deepStrictEqual(
			{ rowOrder: plan.rowOrder, creates: client.queries },
			{
				rowOrder: '"__positron_row_order"',
				creates: [
					`CREATE TEMP TABLE ${relation.replace('temp.', '')} AS ` +
					`SELECT ROW_NUMBER() OVER () AS "__positron_row_order", * FROM "main"."v"`,
				],
			});
	});

	test('dispose drops the snapshot', async () => {
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."v"', 'view', ['id', 'label']);
		const relation = await plan.relation();
		client.queries.length = 0;

		await plan.dispose();

		assert.deepStrictEqual(client.queries, [`DROP TABLE IF EXISTS ${relation}`]);
	});

	test('dispose drops nothing when the snapshot was never materialized', async () => {
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."v"', 'view', ['id', 'label']);

		await plan.dispose();

		assert.deepStrictEqual(client.queries, []);
	});

	test('a read after dispose is refused rather than leaking a fresh snapshot', async () => {
		// A queued column profile can outlive the tab that asked for it. Materializing again here would
		// build a snapshot with nothing left to drop it, so it would sit in `temp` for the rest of the
		// connection's life.
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."v"', 'view', ['id', 'label']);
		await plan.relation();
		await plan.dispose();
		client.queries.length = 0;

		await assert.rejects(() => plan.relation(), /disposed/);
		assert.deepStrictEqual(client.queries, []);
	});

	test('the snapshot is rebuilt after the worker is replaced', async () => {
		// A replacement worker starts with an empty `temp` catalog. Without this, every later read
		// would fail until the user reopened the tab.
		const client = new FakeClient();
		const plan = createDuckDBReadPlan(client, '"main"."v"', 'view', ['id', 'label']);
		await plan.relation();
		const createsBefore = client.queries.filter(q => q.startsWith('CREATE TEMP TABLE')).length;

		client.crash();
		await plan.relation();

		assert.deepStrictEqual(
			{
				createsBefore,
				createsAfter: client.queries.filter(q => q.startsWith('CREATE TEMP TABLE')).length,
			},
			{ createsBefore: 1, createsAfter: 2 });
	});

	test('concurrently open views get distinct snapshots', async () => {
		// One worker serves every connection to the same file, so two open views share a `temp`
		// catalog and must not both claim the same snapshot name.
		const client = new FakeClient();
		const first = createDuckDBReadPlan(client, '"main"."a"', 'view', ['id', 'label']);
		const second = createDuckDBReadPlan(client, '"main"."b"', 'view', ['id', 'label']);

		assert.notStrictEqual(await first.relation(), await second.relation());
	});
});
