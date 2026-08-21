/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createSqliteReadPlan } from '../sqliteReadPlan.js';
import { SqliteRow } from '../sqliteWorkerClient.js';
import { SqliteBindValue } from '../sqliteWorkerProtocol.js';

/**
 * A fake client standing in for one SQLite database.
 *
 * `rowidTables` are ordinary tables, whose rowid probe succeeds. Anything else is treated as a
 * relation with no rowid, so the probe raises the same error SQLite does -- which is what tells the
 * read plan it is looking at a WITHOUT ROWID table.
 *
 * `declaredColumns` names ordinary columns the table declares, which matters when one of them is
 * spelled like a rowid alias: SQLite resolves the name to that column, so the probe succeeds even on
 * a table with no rowid. Modelling that faithfully is what makes the shadowing tests meaningful.
 */
class FakeClient {
	readonly queries: string[] = [];
	private _crashListener: (() => void) | undefined;

	constructor(
		private readonly options: {
			readonly rowidTables?: readonly string[];
			/** Primary key columns per table, in key order, as PRAGMA table_info would report them. */
			readonly primaryKeys?: Readonly<Record<string, readonly string[]>>;
			/** Non-key columns per table, as PRAGMA table_info would report them. */
			readonly declaredColumns?: Readonly<Record<string, readonly string[]>>;
			/** Raised by the rowid probe, to stand in for a failure that is not "no such column". */
			readonly probeError?: Error;
		} = {}
	) { }

	async runQuery(sql: string, _params?: SqliteBindValue[]): Promise<SqliteRow[]> {
		this.queries.push(sql);

		const probe = /^SELECT (rowid|_rowid_|oid) FROM "(.+)" LIMIT 0$/.exec(sql);
		if (probe) {
			const [, alias, table] = probe;
			if (this.options.probeError) {
				throw this.options.probeError;
			}
			// A declared column of the same name shadows the rowid, and the probe then resolves to it.
			const shadowed = this._columnsOf(table).some(name => name.toLowerCase() === alias);
			if (!shadowed && !this.options.rowidTables?.includes(table)) {
				throw new Error(`no such column: ${alias}`);
			}
			return [];
		}

		const pragma = /^PRAGMA table_info\("(.+)"\)$/.exec(sql);
		if (pragma) {
			const keyColumns = this.options.primaryKeys?.[pragma[1]] ?? [];
			return [
				...keyColumns.map((name, i) => ({ name, pk: i + 1 })),
				...(this.options.declaredColumns?.[pragma[1]] ?? []).map(name => ({ name, pk: 0 })),
				{ name: 'payload', pk: 0 },
			];
		}

		return [];
	}

	private _columnsOf(table: string): readonly string[] {
		return [
			...(this.options.primaryKeys?.[table] ?? []),
			...(this.options.declaredColumns?.[table] ?? []),
		];
	}

	/** Stands in for `SqliteWorkerClient.onDidCrash`. */
	onDidCrash = (listener: () => void) => {
		this._crashListener = listener;
		return { dispose: () => { this._crashListener = undefined; } };
	};

	/** Simulates the worker dying and being replaced, which empties the `temp` schema. */
	crash(): void {
		this._crashListener?.();
	}
}

/** Stands in for a relation's full column list, none of which shadows a rowid alias. */
const COLUMNS = ['id', 'payload'];

suite('SQLite read plan Tests', () => {
	suite('row identity', () => {
		test('an ordinary table is read in place, ordered by rowid', async () => {
			const client = new FakeClient({ rowidTables: ['people'] });
			const plan = await createSqliteReadPlan(client, 'people', 'table', COLUMNS);

			assert.deepStrictEqual(
				{ relation: await plan.relation(), rowOrder: plan.rowOrder, queries: client.queries },
				{
					relation: '"people"',
					rowOrder: 'rowid',
					// Two checks and no setup: the column list, to confirm nothing shadows the rowid, and
					// the probe. Neither reads a row.
					queries: ['PRAGMA table_info("people")', 'SELECT rowid FROM "people" LIMIT 0'],
				});
		});

		test('a WITHOUT ROWID table falls back to its primary key, in key order', async () => {
			// `kv` is absent from rowidTables, so the probe fails exactly as it does on a real
			// WITHOUT ROWID table, whose primary key columns are implicitly NOT NULL.
			const client = new FakeClient({ primaryKeys: { kv: ['tenant', 'k'] } });
			const plan = await createSqliteReadPlan(client, 'kv', 'table', COLUMNS);

			assert.deepStrictEqual(
				{ relation: await plan.relation(), rowOrder: plan.rowOrder },
				{ relation: '"kv"', rowOrder: '"tenant", "k"' });
		});

		test('a table whose DDL merely mentions the words WITHOUT ROWID still uses rowid', async () => {
			// A regression guard for reading the stored CREATE statement instead of probing: the DDL
			// `note TEXT DEFAULT 'migrated without rowid'` describes an ordinary rowid table. Reading it
			// as WITHOUT ROWID would silently order by a declared primary key, which an ordinary table
			// may hold NULLs in -- so rows could tie and paging would drift again, with nothing to show
			// that the tiebreaker had stopped working.
			const client = new FakeClient({
				rowidTables: ['migrated'],
				primaryKeys: { migrated: ['id'] },
			});
			const plan = await createSqliteReadPlan(client, 'migrated', 'table', COLUMNS);

			assert.strictEqual(plan.rowOrder, 'rowid');
		});

		test('a table that declares its own rowid column orders by an unshadowed alias', async () => {
			// SQLite lets a table declare a column named `rowid`, and that column then shadows the real
			// rowid: on `CREATE TABLE t(rowid TEXT, v INTEGER)`, `SELECT rowid` hands back the TEXT
			// column, which carries no uniqueness -- three rows of it verifiably read 'a', 'a', 'a'.
			// Ordering by it would put paging right back where this whole change started, and silently,
			// because the probe still succeeds. `_rowid_` names the real rowid instead.
			const client = new FakeClient({
				rowidTables: ['shadow'],
				declaredColumns: { shadow: ['rowid'] },
			});
			const plan = await createSqliteReadPlan(client, 'shadow', 'table', COLUMNS);

			assert.strictEqual(plan.rowOrder, '_rowid_');
		});

		test('a table that declares all three rowid aliases is read through a snapshot', async () => {
			// Nothing can name this table's rowid, and its declared primary key is no substitute: an
			// ordinary table admits NULLs in a PRIMARY KEY column, and a unique index treats every NULL
			// as distinct, so rows can tie.
			const client = new FakeClient({
				rowidTables: ['pathological'],
				primaryKeys: { pathological: ['oid'] },
				declaredColumns: { pathological: ['rowid', '_rowid_'] },
			});
			const plan = await createSqliteReadPlan(
				client, 'pathological', 'table', ['oid', 'rowid', '_rowid_']);

			// The snapshot inherits the same problem -- `SELECT *` copies all three names into it -- so it
			// numbers the rows in a column of its own instead.
			assert.deepStrictEqual(
				{
					readsSnapshot: /^temp\."positron_snapshot_\d+"$/.test(await plan.relation()),
					rowOrder: plan.rowOrder,
				},
				{ readsSnapshot: true, rowOrder: '"__positron_row_order"' });
		});

		test('a probe failure that is not "no such column" is raised, not treated as WITHOUT ROWID', async () => {
			// A dead worker must not be read as evidence that a table has no rowid. Doing so would fall
			// through to the primary key, which is only a total order on a table that genuinely has none
			// -- so an ordinary table with a nullable TEXT primary key would page unstably. Failing the
			// open is recoverable; the user reopens the tab.
			const client = new FakeClient({
				probeError: new Error('The SQLite process terminated unexpectedly (signal SIGKILL).'),
				primaryKeys: { people: ['email'] },
			});

			await assert.rejects(
				() => createSqliteReadPlan(client, 'people', 'table', COLUMNS),
				/terminated unexpectedly/);
		});

		test('quotes an identifier that contains a double quote', async () => {
			const client = new FakeClient({ primaryKeys: { odd: ['we"ird'] } });
			const plan = await createSqliteReadPlan(client, 'odd', 'table', COLUMNS);

			assert.strictEqual(plan.rowOrder, '"we""ird"');
		});
	});

	suite('snapshot', () => {
		test('a view is read through a snapshot, materialized once and ordered by rowid', async () => {
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(client, 'sales_by_region', 'view', COLUMNS);

			// Nothing is created until the first read, so opening a view costs nothing extra.
			assert.deepStrictEqual(client.queries, []);

			const first = await plan.relation();
			const second = await plan.relation();

			assert.deepStrictEqual(
				{
					reusesOneSnapshot: first === second,
					readsFromTempSchema: /^temp\."positron_snapshot_\d+"$/.test(first),
					rowOrder: plan.rowOrder,
					creates: client.queries,
				},
				{
					reusesOneSnapshot: true,
					readsFromTempSchema: true,
					rowOrder: 'rowid',
					// Materialized exactly once, however many reads follow. The CREATE names the
					// snapshot unqualified, because SQLite rejects a schema-qualified name there.
					creates: [`CREATE TEMP TABLE ${first.replace('temp.', '')} AS SELECT * FROM "sales_by_region"`],
				});
		});

		test('a view that emits a rowid column is snapshotted under an unshadowed alias', async () => {
			// `SELECT *` copies the view's columns verbatim, so a view emitting `rowid` puts a column of
			// that name into the snapshot, where it shadows the snapshot's own rowid. Ordering by the
			// name would read the copied column, which carries no uniqueness once a join has fanned the
			// view out. `CREATE VIEW v AS SELECT rowid, name FROM t` is idiomatic enough to expect.
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(client, 'v', 'view', ['rowid', 'total']);

			const relation = await plan.relation();

			assert.deepStrictEqual(
				{ rowOrder: plan.rowOrder, creates: client.queries },
				{
					// Still free: a TEMP table's rowid is its storage order under any of its names.
					rowOrder: '_rowid_',
					creates: [`CREATE TEMP TABLE ${relation.replace('temp.', '')} AS SELECT * FROM "v"`],
				});
		});

		test('a view that emits every rowid alias is numbered explicitly', async () => {
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(
				client, 'v', 'view', ['rowid', '_rowid_', 'oid', 'total']);

			const relation = await plan.relation();

			assert.deepStrictEqual(
				{ rowOrder: plan.rowOrder, creates: client.queries },
				{
					rowOrder: '"__positron_row_order"',
					creates: [
						`CREATE TEMP TABLE ${relation.replace('temp.', '')} AS ` +
						`SELECT ROW_NUMBER() OVER () AS "__positron_row_order", * FROM "v"`,
					],
				});
		});

		test('a table with neither a rowid nor a primary key is read through a snapshot', async () => {
			// Not reachable on a real database -- SQLite requires a primary key on a WITHOUT ROWID
			// table -- but the fallback has to be a stable order rather than no order at all.
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(client, 'exotic', 'table', COLUMNS);

			assert.match(await plan.relation(), /^temp\."positron_snapshot_\d+"$/);
		});

		test('dispose drops the snapshot', async () => {
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(client, 'v', 'view', COLUMNS);
			const relation = await plan.relation();
			client.queries.length = 0;

			await plan.dispose();

			assert.deepStrictEqual(client.queries, [`DROP TABLE IF EXISTS ${relation}`]);
		});

		test('dispose drops nothing when the snapshot was never materialized', async () => {
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(client, 'v', 'view', COLUMNS);

			await plan.dispose();

			assert.deepStrictEqual(client.queries, []);
		});

		test('a read after dispose is refused rather than leaking a fresh snapshot', async () => {
			// A queued column profile can outlive the tab that asked for it. Materializing again here
			// would build a snapshot with nothing left to drop it, so it would sit in `temp` for the
			// rest of the connection's life.
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(client, 'v', 'view', COLUMNS);
			await plan.relation();
			await plan.dispose();
			client.queries.length = 0;

			await assert.rejects(() => plan.relation(), /disposed/);
			assert.deepStrictEqual(client.queries, []);
		});

		test('the snapshot is rebuilt after the worker is replaced', async () => {
			// A replacement worker starts with an empty `temp` schema. Without this, every later read
			// would fail with "no such table" until the user reopened the tab.
			const client = new FakeClient();
			const plan = await createSqliteReadPlan(client, 'v', 'view', COLUMNS);
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

		test('a failed materialization is retried rather than cached', async () => {
			let attempts = 0;
			const client = new FakeClient();
			const failing = {
				...client,
				runQuery: async (sql: string) => {
					if (sql.startsWith('CREATE TEMP TABLE') && ++attempts === 1) {
						throw new Error('database or disk is full');
					}
					return client.runQuery(sql);
				},
			};
			const plan = await createSqliteReadPlan(failing, 'v', 'view', COLUMNS);

			await assert.rejects(() => plan.relation(), /disk is full/);
			await plan.relation();

			assert.strictEqual(attempts, 2);
		});
	});
});
