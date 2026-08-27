/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConnectionRef } from '../schema';
import { ConnectionSelection, EffectiveSelection, resolveSelection, SelectionStore } from '../selection';
import { describeSelection, DialectInUse, pickConnection } from '../statusBar';

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

	test('a choice of a connection since removed is no choice at all', () => {
		// Nothing can open it, so pointing the user at it would be a dead end.
		assert.deepStrictEqual(resolveSelection(WAREHOUSE, [], [LOCAL]), { kind: 'none' });
		assert.deepStrictEqual(
			resolveSelection(WAREHOUSE, [LOCAL], [LOCAL]),
			{ kind: 'connection', connection: LOCAL },
		);
		// Before the first read nothing is known to be removed, and the choice stands.
		assert.deepStrictEqual(
			resolveSelection(WAREHOUSE, [], undefined),
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

		selection.forgetIfTransient(SCRATCH, 'SELECT 1');

		assert.strictEqual(selection.get(SCRATCH), undefined);
	});

	test('an untitled buffer saved as a file hands its choice to the file', () => {
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);

		// Saving closes the buffer and opens the file, with the same text.
		selection.forgetIfTransient(SCRATCH, 'SELECT * FROM orders');
		const adopted = selection.adopt(REPORT, 'SELECT * FROM orders');

		assert.deepStrictEqual([adopted, selection.get(REPORT)], [true, WAREHOUSE]);
	});

	test('a file that opens empty and then receives the buffer\'s text still takes its choice', () => {
		// What Save As does: the file opens with no text, and the buffer's text arrives as its
		// first change.
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);
		selection.forgetIfTransient(SCRATCH, 'SELECT * FROM orders');

		const onOpen = selection.adopt(REPORT, '');
		const onFirstChange = selection.adopt(REPORT, 'SELECT * FROM orders');

		assert.deepStrictEqual([onOpen, onFirstChange, selection.get(REPORT)], [false, true, WAREHOUSE]);
	});

	test('a buffer still open hands its choice to the file it was saved as', () => {
		// The editor may report the file's text before it reports the buffer closing.
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);

		const adopted = selection.adopt(REPORT, 'SELECT 1', [{ uri: SCRATCH, text: 'SELECT 1' }]);
		const unrelated = selection.adopt(MIGRATION, 'SELECT 2', [{ uri: SCRATCH, text: 'SELECT 1' }]);

		assert.deepStrictEqual([adopted, unrelated, selection.get(REPORT)], [true, false, WAREHOUSE]);
	});

	test('a buffer reopened with its text, after changing language, keeps its choice', () => {
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);

		selection.forgetIfTransient(SCRATCH, 'SELECT 1');
		const reopened = selection.reopen(SCRATCH, 'SELECT 1');

		assert.deepStrictEqual([reopened, selection.get(SCRATCH)], [true, WAREHOUSE]);
	});

	test('a new buffer handed a closed buffer\'s URI does not inherit its choice', () => {
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);

		selection.forgetIfTransient(SCRATCH, 'SELECT 1');
		const reopened = selection.reopen(SCRATCH, '');

		assert.deepStrictEqual([reopened, selection.get(SCRATCH)], [false, undefined]);
	});

	test('a choice is handed over only to the same text, and only once', () => {
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);
		selection.forgetIfTransient(SCRATCH, 'SELECT * FROM orders');

		const other = selection.adopt(MIGRATION, 'SELECT 1');
		const first = selection.adopt(REPORT, 'SELECT * FROM orders');
		const second = selection.adopt(vscode.Uri.file('/elsewhere.sql'), 'SELECT * FROM orders');

		assert.deepStrictEqual([other, first, second], [false, true, false]);
	});

	test('an empty buffer hands nothing over, since every new file is empty too', () => {
		const selection = new ConnectionSelection(store());
		selection.set(SCRATCH, WAREHOUSE);
		selection.forgetIfTransient(SCRATCH, '');

		assert.strictEqual(selection.adopt(REPORT, ''), false);
	});

	test('a renamed file, or a file in a renamed folder, keeps its choice', () => {
		const kept = store();
		const selection = new ConnectionSelection(kept);
		selection.set(REPORT, WAREHOUSE);
		selection.set(MIGRATION, LOCAL);

		selection.rename(REPORT, vscode.Uri.file('/reports/quarterly.sql'));
		selection.rename(vscode.Uri.file('/db'), vscode.Uri.file('/database'));

		assert.deepStrictEqual(
			[
				selection.get(vscode.Uri.file('/reports/quarterly.sql')),
				selection.get(vscode.Uri.file('/database/001-init.sql')),
				selection.get(REPORT),
			],
			[WAREHOUSE, LOCAL, undefined],
		);
		assert.deepStrictEqual(
			Object.keys(kept.written).sort(),
			[vscode.Uri.file('/database/001-init.sql').toString(), vscode.Uri.file('/reports/quarterly.sql').toString()],
		);
	});

	test('a rename says whether it moved a choice, which is what decides a refresh', () => {
		const selection = new ConnectionSelection(store());
		selection.set(REPORT, WAREHOUSE);

		const unrelated = selection.rename(vscode.Uri.file('/notes.txt'), vscode.Uri.file('/notes.md'));
		const moved = selection.rename(REPORT, vscode.Uri.file('/reports/quarterly.sql'));

		assert.deepStrictEqual([unrelated, moved], [false, true]);
	});

	test('a file saved as another, from disk rather than untitled, hands its choice over', () => {
		// Save As leaves the original open beside the new file, holding the same text.
		const selection = new ConnectionSelection(store());
		selection.set(REPORT, WAREHOUSE);

		const adopted = selection.adopt(
			vscode.Uri.file('/reports/quarterly-v2.sql'),
			'SELECT * FROM orders',
			[{ uri: REPORT, text: 'SELECT * FROM orders' }],
		);

		assert.deepStrictEqual(
			[adopted, selection.get(vscode.Uri.file('/reports/quarterly-v2.sql'))],
			[true, WAREHOUSE],
		);
	});

	test('a closed file on disk does keep its choice, which is the point of storing it', () => {
		const selection = new ConnectionSelection(store());
		selection.set(REPORT, WAREHOUSE);

		selection.forgetIfTransient(REPORT, 'SELECT 1');

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
		configured: readonly ConnectionRef[] | undefined,
		dialect: DialectInUse = SNOWFLAKE,
	) {
		const state = describeSelection(selection, configured, dialect);
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

	test('several set up and none chosen asks for a choice, which is the job to do', () => {
		assert.deepStrictEqual(
			shown({ kind: 'none' }, [WAREHOUSE, LOCAL]),
			{ text: '$(alert) Select Data Connection', warning: true },
		);
	});

	test('one set up but not open still asks for a choice, since choosing it opens it', () => {
		assert.deepStrictEqual(
			shown({ kind: 'none' }, [WAREHOUSE]),
			{ text: '$(alert) Select Data Connection', warning: true },
		);
	});

	test('nothing set up at all asks for a connection instead, which is the other job', () => {
		assert.deepStrictEqual(
			shown({ kind: 'none' }, []),
			{ text: '$(alert) No Data Connection', warning: true },
		);
	});

	test('before the first read, nothing is reported as missing', () => {
		// Nothing is known to be open yet, so a chosen connection would read as closed and a
		// window with connections set up as having none.
		assert.deepStrictEqual(
			[shown({ kind: 'closed', connection: WAREHOUSE }, undefined), shown({ kind: 'none' }, undefined)],
			[
				{ text: '$(loading~spin) Sales Warehouse', warning: false },
				{ text: '$(loading~spin) Data Connection', warning: false },
			],
		);
	});

	test('a name that looks like an icon is shown as typed', () => {
		const named = { ...WAREHOUSE, name: 'Prod $(flame)' };

		assert.deepStrictEqual(
			shown({ kind: 'connection', connection: named }, [named]),
			{ text: '$(database) Prod \\$(flame)', warning: false },
		);
	});
});

/**
 * The hover, which is where a user finds out how their file is being read. The dialect is not
 * visible anywhere else, and a wrong one shows up only as syntax errors on SQL that is fine.
 */
suite('describeSelection hover', () => {

	function hover(dialect: DialectInUse, connection: ConnectionRef = WAREHOUSE): string {
		return describeSelection(
			{ kind: 'connection', connection },
			[connection],
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

	test('a connection named like markdown is shown as typed, not formatted', () => {
		const shown = hover(
			{ dialect: 'snowflake', fromSetting: false },
			{ ...WAREHOUSE, name: 'sales_*[eu](https://example.com)*' },
		);

		assert.ok(shown.startsWith('**sales\\_\\*\\[eu\\]\\(https://example\\.com\\)\\***'), shown);
	});
});

/**
 * The picker, when there is nothing to pick. Running a statement awaits this while it holds a guard
 * against a second run, so how long it takes to return is how long every later run does nothing.
 */
suite('pickConnection', () => {

	const showInformationMessage = vscode.window.showInformationMessage;
	let shownMessages: string[];

	setup(() => {
		shownMessages = [];
		// A notification the user never answers, which is what one that hid itself is: its answer
		// arrives only if they find it in the notification center.
		(vscode.window as { showInformationMessage: unknown }).showInformationMessage = (message: string) => {
			shownMessages.push(message);
			return new Promise<undefined>(() => { });
		};
	});

	teardown(() => {
		(vscode.window as { showInformationMessage: unknown }).showInformationMessage = showInformationMessage;
	});

	test('nothing set up says so and returns without waiting for an answer', async () => {
		const timedOut = Symbol('timed out');
		const result = await Promise.race([
			pickConnection([], [], undefined),
			new Promise<typeof timedOut>(resolve => setTimeout(() => resolve(timedOut), 1000)),
		]);

		assert.deepStrictEqual(
			{ result, shownMessages },
			{
				result: undefined,
				shownMessages: ['No data connection is set up. Add one in the Data Connections pane to use it with this file.'],
			},
		);
	});

	test('a connection that is set up but not open is offered, marked as such', async () => {
		// One just added in the Data Connections pane is closed, and is the one the user is after.
		const showQuickPick = vscode.window.showQuickPick;
		let offered: readonly vscode.QuickPickItem[] = [];
		(vscode.window as { showQuickPick: unknown }).showQuickPick = async (items: readonly vscode.QuickPickItem[]) => {
			offered = items;
			return items[1];
		};
		try {
			const result = await pickConnection([WAREHOUSE, LOCAL], [WAREHOUSE], WAREHOUSE);

			assert.deepStrictEqual(
				{
					result,
					offered: offered.map(item => ({ label: item.label, description: item.description })),
				},
				{
					result: LOCAL,
					offered: [
						{ label: WAREHOUSE.name, description: 'Current' },
						{ label: LOCAL.name, description: 'Not connected' },
					],
				},
			);
		} finally {
			(vscode.window as { showQuickPick: unknown }).showQuickPick = showQuickPick;
		}
	});
});
