/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConnectionRef } from '../schema';
import { ConnectionSelection, EffectiveSelection, resolveSelection, SelectionStore } from '../selection';
import { describeSelection, DialectInUse } from '../statusBar';

const WAREHOUSE: ConnectionRef = {
	profileId: 'warehouse',
	name: 'Sales Warehouse',
	driverId: 'positron-data-driver-snowflake',
};
const LOCAL: ConnectionRef = {
	profileId: 'local',
	name: 'Local DuckDB',
	driverId: 'positron-data-driver-duckdb',
};

suite('resolveSelection', () => {

	test('a file that chose nothing takes the only open connection', () => {
		// One database open and a window full of SQL is the common case, and there is nothing else
		// the file could mean, so it does not cost a click per file.
		assert.deepStrictEqual(
			resolveSelection(undefined, [WAREHOUSE]),
			{ kind: 'connection', connection: WAREHOUSE },
		);
	});

	test('a file that chose nothing with several open draws on none of them', () => {
		// No default is worth having here: whichever was picked would be wrong for half the files.
		assert.deepStrictEqual(
			resolveSelection(undefined, [WAREHOUSE, LOCAL]),
			{ kind: 'none' },
		);
	});

	test('a file that chose nothing with nothing open has nothing', () => {
		assert.deepStrictEqual(resolveSelection(undefined, []), { kind: 'none' });
	});

	test('a file that chose an open connection is scoped to it', () => {
		assert.deepStrictEqual(
			resolveSelection(WAREHOUSE, [WAREHOUSE, LOCAL]),
			{ kind: 'connection', connection: WAREHOUSE },
		);
	});

	test('a connection renamed since it was chosen is still the one chosen', () => {
		// The choice is by id, so the file follows the connection rather than the label on it.
		const renamed = { ...WAREHOUSE, name: 'Sales Warehouse (EU)' };

		assert.deepStrictEqual(
			resolveSelection(WAREHOUSE, [renamed]),
			{ kind: 'connection', connection: renamed },
		);
	});

	test('a file whose connection is not open falls back to nothing, not to the others', () => {
		// The whole point of choosing: the tables of a database this file was not written against
		// would be worse than no tables at all.
		assert.deepStrictEqual(
			resolveSelection(WAREHOUSE, [LOCAL]),
			{ kind: 'closed', connection: WAREHOUSE },
		);
	});
});

suite('ConnectionSelection', () => {

	/** A memento that keeps what was written to it, standing in for the workspace's. */
	function store(initial: Record<string, unknown> = {}): SelectionStore & { written: Record<string, unknown> } {
		let written = initial;
		return {
			get written() { return written; },
			get: (<T>() => written as unknown as T) as SelectionStore['get'],
			update: (_key: string, value: unknown) => {
				written = value as Record<string, unknown>;
				return Promise.resolve();
			},
		};
	}

	/** A file on disk, whose URI means the same thing in the next session. */
	const REPORT = vscode.Uri.file('/reports/monthly.sql');
	const MIGRATION = vscode.Uri.file('/db/001-init.sql');

	/** A scratch buffer, whose URI is handed out again from the start of the next session. */
	const SCRATCH = vscode.Uri.parse('untitled:Untitled-1');

	test('the choice is per file, not per window', () => {
		const selection = new ConnectionSelection(store());

		selection.set(REPORT, WAREHOUSE);
		selection.set(MIGRATION, LOCAL);

		assert.deepStrictEqual(
			[selection.get(REPORT), selection.get(MIGRATION)],
			[WAREHOUSE, LOCAL],
		);
	});

	test('a saved file keeps its choice for the next window', () => {
		const kept = store();
		new ConnectionSelection(kept).set(REPORT, WAREHOUSE);

		// What the next window does: read the same store back.
		const reopened = new ConnectionSelection(store(kept.written));

		assert.deepStrictEqual(reopened.get(REPORT), WAREHOUSE);
	});

	test('an untitled buffer\'s choice is not kept, its URI being handed out again', () => {
		const kept = store();

		new ConnectionSelection(kept).set(SCRATCH, WAREHOUSE);

		assert.deepStrictEqual(kept.written, {}, 'nothing should have been stored');
	});

	test('a closed untitled buffer does not leave its choice behind', () => {
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);

		selection.forgetIfTransient(SCRATCH);

		assert.strictEqual(selection.get(SCRATCH), undefined);
	});

	test('a closed file on disk does keep its choice, which is the point of storing it', () => {
		const selection = new ConnectionSelection(store());
		selection.set(REPORT, WAREHOUSE);

		selection.forgetIfTransient(REPORT);

		assert.deepStrictEqual(selection.get(REPORT), WAREHOUSE);
	});

	test('the language a file was run in is remembered with its connection', () => {
		const kept = store();
		const selection = new ConnectionSelection(kept);
		selection.set(REPORT, WAREHOUSE);

		selection.setLanguage(REPORT, 'r');

		assert.strictEqual(new ConnectionSelection(store(kept.written)).get(REPORT)?.languageId, 'r');
	});

	test('choosing a different connection forgets the language, which was about the old one', () => {
		// A different database is reached through a different driver, which may not even offer the
		// language the file was last run in.
		const selection = new ConnectionSelection(store());
		selection.set(REPORT, WAREHOUSE);
		selection.setLanguage(REPORT, 'r');

		selection.set(REPORT, LOCAL);

		assert.strictEqual(selection.get(REPORT)?.languageId, undefined);
	});

	test('a language on its own is not kept, there being no connection for it to be about', () => {
		const selection = new ConnectionSelection(store());

		selection.setLanguage(REPORT, 'r');

		assert.strictEqual(selection.get(REPORT), undefined);
	});

	test('an entry stored before languages existed is still read', () => {
		const selection = new ConnectionSelection(store({
			[REPORT.toString()]: WAREHOUSE,
		}));

		assert.deepStrictEqual(selection.get(REPORT), WAREHOUSE);
	});

	test('a stored entry that is not a connection is dropped rather than shown', () => {
		// Written by an older version of this extension, or half written. A partial entry would
		// reach the status bar as a connection with no name.
		const selection = new ConnectionSelection(store({
			[REPORT.toString()]: { profileId: 'warehouse' },
		}));

		assert.strictEqual(selection.get(REPORT), undefined);
	});
});

/**
 * What the status bar says, which is the only place the four states are told apart: they all look
 * alike in the editor, as a completion list with no tables in it.
 */
suite('describeSelection', () => {

	/** The dialect a Snowflake connection infers, which is what these states are shown with. */
	const SNOWFLAKE: DialectInUse = { dialect: 'snowflake', fromSetting: false };

	/** The text and the warning treatment; what the hover says is asserted separately. */
	function shown(
		selection: EffectiveSelection,
		open: readonly ConnectionRef[],
		dialect: DialectInUse = SNOWFLAKE,
	) {
		const state = describeSelection(selection, open, dialect);
		return { text: state.text, warning: state.warning };
	}

	test('a scoped file names its connection, without alarm', () => {
		assert.deepStrictEqual(
			shown({ kind: 'connection', connection: WAREHOUSE }, [WAREHOUSE]),
			{ text: '$(database) Sales Warehouse', warning: false },
		);
	});

	test('a file whose connection is closed is a warning, since it completes nothing', () => {
		assert.deepStrictEqual(
			shown({ kind: 'closed', connection: WAREHOUSE }, [LOCAL]),
			{ text: '$(alert) Sales Warehouse', warning: true },
		);
	});

	test('several open and none chosen asks for a choice, which is the job to do', () => {
		assert.deepStrictEqual(
			shown({ kind: 'none' }, [WAREHOUSE, LOCAL]),
			{ text: '$(alert) Select Data Connection', warning: true },
		);
	});

	test('nothing open at all asks for a connection instead, which is the other job', () => {
		assert.deepStrictEqual(
			shown({ kind: 'none' }, []),
			{ text: '$(alert) No Data Connection', warning: true },
		);
	});
});

/**
 * The hover, which is where a user finds out how their file is being read. The dialect is not
 * visible anywhere else, and a wrong one shows up only as syntax errors on SQL that is fine.
 */
suite('describeSelection hover', () => {

	function hover(dialect: DialectInUse): string {
		return describeSelection(
			{ kind: 'connection', connection: WAREHOUSE },
			[WAREHOUSE],
			dialect,
		).tooltip.value;
	}

	test('the connection and the dialect it implies are both named', () => {
		const shown = hover({ dialect: 'snowflake', fromSetting: false });

		assert.ok(shown.includes('Sales Warehouse'), shown);
		assert.ok(shown.includes('Snowflake'), shown);
		assert.ok(shown.includes('from the connection'), shown);
	});

	test('a dialect from the setting says so, since that is where to change it', () => {
		const shown = hover({ dialect: 'tsql', fromSetting: true });

		assert.ok(shown.includes('Transact-SQL'), shown);
		assert.ok(shown.includes('sql.dialect'), shown);
	});

	test('no dialect in play is still said, being why nothing is reported as wrong', () => {
		const shown = hover({ dialect: '', fromSetting: false });

		assert.ok(shown.includes('Generic'), shown);
	});
});
