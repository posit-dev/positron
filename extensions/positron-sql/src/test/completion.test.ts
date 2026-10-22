/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { explainEmptyQualifier, SqlCompletionItemProvider } from '../completion';
import { SqlTable } from '../schema';
import { SchemaIndex } from '../schemaIndex';
import { payloadOf, schemaOf, sqlDocument, testAnalyzer, testLog } from './support';

const SCHEMA = schemaOf('sales.orders: id, total, Order Total', 'customers: id, name');

/**
 * Completes at the cursor, written as `|` in the text.
 *
 * Returns the labels, which is what the user reads in the list. What each item inserts is checked
 * separately, by the tests that are about insertion.
 */
async function complete(
	marked: string,
	options: { schema?: SchemaIndex; dialect?: string; trigger?: string } = {},
): Promise<{
	labels: string[];
	list: vscode.CompletionList;
	document: vscode.TextDocument;
	messages: string[];
}> {
	const offset = marked.indexOf('|');
	assert.notStrictEqual(offset, -1, 'the text must mark the cursor with |');
	const text = marked.replace('|', '');

	const document = await sqlDocument(text);
	const { log, messages } = testLog();
	const provider = new SqlCompletionItemProvider(() => ({
		analyzer: testAnalyzer(),
		schema: options.schema ?? SCHEMA,
		dialect: options.dialect ?? '',
		keywords: testAnalyzer().keywords(),
		log,
	}));
	const context: vscode.CompletionContext = options.trigger === undefined
		? { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined }
		: { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: options.trigger };
	const list = provider.provideCompletionItems(
		document,
		document.positionAt(offset),
		new vscode.CancellationTokenSource().token,
		context,
	);
	return {
		labels: list.items.map(item => (typeof item.label === 'string' ? item.label : item.label.label)),
		list,
		document,
		messages,
	};
}

/** The completions of a given kind, which is what separates a column from a table of that name. */
function ofKind(list: vscode.CompletionList, kind: vscode.CompletionItemKind): string[] {
	return list.items
		.filter(item => item.kind === kind)
		.map(item => (typeof item.label === 'string' ? item.label : item.label.label));
}

/** What the item with a given label inserts. */
function inserted(list: vscode.CompletionList, wanted: string): string | undefined {
	const item = list.items.find(each => (typeof each.label === 'string' ? each.label : each.label.label) === wanted);
	return item?.insertText as string | undefined;
}

/** The text an item replaces in the editor's insert mode, and in its replace mode. */
function extents(document: vscode.TextDocument, item: vscode.CompletionItem): [string, string] {
	const range = item.range as { inserting: vscode.Range; replacing: vscode.Range };
	return [document.getText(range.inserting), document.getText(range.replacing)];
}

suite('SqlCompletionItemProvider', () => {

	test('the select after a WITH is offered the CTE\'s own columns', async () => {
		const { list } = await complete('WITH recent AS (SELECT id, total AS amount FROM orders) SELECT | FROM recent');

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Field), ['id', 'amount']);
	});

	test('a CTE name followed by a dot offers its columns, a star read through the schema', async () => {
		const named = await complete('WITH r AS (SELECT id, total AS amount FROM orders) SELECT r.| FROM r');
		const starred = await complete('WITH r AS (SELECT * FROM customers) SELECT x.| FROM r x');

		assert.deepStrictEqual(named.labels, ['id', 'amount']);
		assert.deepStrictEqual(starred.labels, ['id', 'name']);
	});

	test('a CTE name followed by a dot offers its columns before the FROM that reads it is typed', async () => {
		const { labels } = await complete('WITH recent AS (SELECT id, total AS amount FROM orders)\nSELECT recent.|');

		assert.deepStrictEqual(labels, ['id', 'amount']);
	});

	test('a derived table\'s alias followed by a dot offers what its select list produces', async () => {
		const { labels } = await complete('SELECT s.| FROM (SELECT id AS k, name FROM customers) s');

		assert.deepStrictEqual(labels, ['k', 'name']);
	});

	test('a name several schemas have completes the default schema\'s table', async () => {
		const schema = new SchemaIndex(payloadOf('main.orders: id, total', 'sales.orders: order_no, region'), 'main');
		const { list } = await complete('SELECT o.| FROM orders o', { schema });

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Field), ['id', 'total']);
	});

	test('a table outside the default schema is inserted with its schema', async () => {
		const schema = new SchemaIndex(payloadOf('main.orders: id', 'sales.targets: goal'), 'main');
		const { list } = await complete('SELECT * FROM |', { schema });

		assert.deepStrictEqual([inserted(list, 'orders'), inserted(list, 'targets')], ['orders', 'sales.targets']);
	});

	test('a name that is a reserved word is quoted when inserted', async () => {
		const schema = schemaOf('orders: id, order, group, status');
		const { list } = await complete('SELECT | FROM orders', { schema, dialect: 'duckdb' });

		assert.deepStrictEqual(
			['id', 'order', 'group', 'status'].map(name => inserted(list, name)),
			['id', '"order"', '"group"', 'status'],
		);
	});

	test('a mixed case name is quoted where the engine folds case', async () => {
		const schema = schemaOf('Customers: CustomerID, name');
		const postgres = await complete('SELECT * FROM Cus|', { schema, dialect: 'postgres' });
		const duckdb = await complete('SELECT * FROM Cus|', { schema, dialect: 'duckdb' });
		const snowflake = await complete('SELECT * FROM |', { schema: schemaOf('ORDERS: id'), dialect: 'snowflake' });

		assert.deepStrictEqual(
			[inserted(postgres.list, 'Customers'), inserted(duckdb.list, 'Customers'), inserted(snowflake.list, 'ORDERS')],
			['"Customers"', 'Customers', 'ORDERS'],
		);
	});

	test('BigQuery quotes a name with backticks, a double quote being a string there', async () => {
		const { list } = await complete('SELECT * FROM |', { dialect: 'bigquery', schema: schemaOf('order items: id') });

		assert.strictEqual(inserted(list, 'order items'), '`order items`');
	});

	test('a prefix matches the start of any word in a name', async () => {
		const schema = schemaOf('orders: user_id, CustomerID, total');
		const { labels } = await complete('SELECT id| FROM orders', { schema });

		assert.deepStrictEqual(labels, ['user_id', 'CustomerID']);
	});

	test('an alias qualifier offers that table\'s columns', async () => {
		const { list } = await complete('SELECT o.| FROM orders o');

		assert.deepStrictEqual(
			ofKind(list, vscode.CompletionItemKind.Field),
			['id', 'total', 'Order Total'],
		);
	});

	test('a table name qualifier works without an alias', async () => {
		const { list } = await complete('SELECT orders.| FROM orders');

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Field), ['id', 'total', 'Order Total']);
	});

	test('only the qualified table\'s columns are offered', async () => {
		const { labels } = await complete('SELECT c.| FROM orders o, customers c');

		assert.deepStrictEqual(labels, ['id', 'name']);
	});

	test('no keywords are offered after a dot', async () => {
		// A keyword is never valid immediately after one.
		const { list } = await complete('SELECT o.| FROM orders o');

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Keyword), []);
	});

	test('an unqualified position offers the columns of every table in scope', async () => {
		const { list } = await complete('SELECT | FROM orders o JOIN customers c ON true');

		assert.deepStrictEqual(
			ofKind(list, vscode.CompletionItemKind.Field),
			['id', 'total', 'Order Total', 'id', 'name'],
		);
	});

	test('an unqualified position also offers tables and keywords', async () => {
		const { list } = await complete('SELECT | FROM orders');
		const keywords = ofKind(list, vscode.CompletionItemKind.Keyword);

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Class), ['orders', 'customers']);
		// A select list, so `DISTINCT` belongs here and `WHERE`, which opens the clause after it,
		// does not.
		assert.ok(keywords.includes('DISTINCT'), keywords.join(', '));
		assert.ok(!keywords.includes('WHERE'), keywords.join(', '));
	});

	test('an unqualified position offers the aliases the statement gave its tables', async () => {
		const { list } = await complete('SELECT | FROM orders o JOIN customers c ON true');

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Variable), ['o', 'c']);
		const alias = list.items.find(item => item.label === 'o');
		assert.strictEqual(alias?.documentation, 'Alias of orders');
	});

	test('an alias is offered for a table the schema does not know, and without a schema', async () => {
		const unknown = await complete('SELECT | FROM shipments s');
		const empty = await complete('SELECT | FROM orders o', { schema: schemaOf() });

		assert.deepStrictEqual(ofKind(unknown.list, vscode.CompletionItemKind.Variable), ['s']);
		assert.deepStrictEqual(ofKind(empty.list, vscode.CompletionItemKind.Variable), ['o']);
	});

	test('an alias ranks with the columns, ahead of the tables and keywords', async () => {
		const { list } = await complete('SELECT o| FROM orders o');

		assert.strictEqual(list.items.find(item => item.label === 'o')?.sortText?.[0], '1');
	});

	test('a select-list alias is offered where it can be named, and says what it renames', async () => {
		const { list } = await complete('SELECT total AS t FROM orders ORDER BY |');
		const alias = list.items.find(item => item.label === 't');

		assert.strictEqual(alias?.kind, vscode.CompletionItemKind.Variable);
		assert.strictEqual(alias?.documentation, 'Alias of total');
	});

	test('a derived table\'s alias is offered', async () => {
		const { list } = await complete('SELECT | FROM (SELECT id FROM orders) x');

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Variable), ['x']);
	});

	test('a CTE is offered with the tables, once', async () => {
		const before = await complete('WITH recent AS (SELECT * FROM orders) SELECT * FROM |');
		// Once read it is also the relation the select reads, and is still one word to type.
		const after = await complete('WITH recent AS (SELECT * FROM orders) SELECT | FROM recent');

		assert.ok(ofKind(before.list, vscode.CompletionItemKind.Class).includes('recent'));
		assert.deepStrictEqual(after.labels.filter(label => label === 'recent'), ['recent']);
	});

	test('no alias is offered after a dot', async () => {
		const { list } = await complete('SELECT o.| FROM orders o');

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Variable), []);
	});

	test('columns are offered from the statement the cursor is in', async () => {
		const { list } = await complete('SELECT * FROM orders;\nSELECT | FROM customers');

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Field), ['id', 'name']);
	});

	test('a column carries its owning table', async () => {
		const { list } = await complete('SELECT o.| FROM orders o');

		assert.strictEqual(list.items[0].documentation, 'Column of sales.orders');
	});

	test('a table carries its qualified name and connection', async () => {
		const { list } = await complete('SELECT * FROM ord|');
		const table = list.items.find(item => item.kind === vscode.CompletionItemKind.Class)!;

		assert.strictEqual(table.documentation, 'sales.orders (Test Connection)');
	});

	test('a namespace qualifier offers its tables', async () => {
		const { labels } = await complete('SELECT * FROM sales.|');

		assert.deepStrictEqual(labels, ['orders']);
	});

	test('an unknown qualifier offers nothing', async () => {
		assert.deepStrictEqual((await complete('SELECT nothing.|')).labels, []);
	});

	test('an empty list says why, since the editor shows nothing at all', async () => {
		const { messages } = await complete('SELECT nothing.|');

		assert.ok(
			messages.some(message => message.includes('"nothing"')),
			`Expected the qualifier to be named in the log, got ${JSON.stringify(messages)}`,
		);
	});

	test('a table outranks the keywords it shares a prefix with', async () => {
		// The editor sorts by sortText before its own fuzzy score.
		const { list } = await complete('SELECT * FROM ord|');
		const sorted = [...list.items].sort((left, right) =>
			(left.sortText ?? '').localeCompare(right.sortText ?? ''));

		assert.strictEqual(sorted[0].kind, vscode.CompletionItemKind.Class);
	});

	test('the prefix filters the list', async () => {
		const { labels } = await complete('SELECT * FROM cust|');

		assert.deepStrictEqual(labels, ['customers']);
	});

	test('the completion replaces the partial identifier', async () => {
		const { list, document } = await complete('SELECT * FROM cust|');

		assert.deepStrictEqual(extents(document, list.items[0]), ['cust', 'cust']);
	});

	test('an identifier needing quotes inserts quoted', async () => {
		const { list } = await complete('SELECT o.Order| FROM orders o');

		assert.strictEqual(list.items[0].label, 'Order Total');
		assert.strictEqual(list.items[0].insertText, '"Order Total"');
	});

	test('the quote style follows the dialect', async () => {
		// Named as the setting and the connection drivers name them: `tsql`, not sqlparser's
		// `mssql`, which is a spelling no dialect ever arrives here under.
		const backticks = await complete('SELECT o.Order| FROM orders o', { dialect: 'mysql' });
		const brackets = await complete('SELECT o.Order| FROM orders o', { dialect: 'tsql' });

		assert.strictEqual(backticks.list.items[0].insertText, '`Order Total`');
		assert.strictEqual(brackets.list.items[0].insertText, '[Order Total]');
	});

	test('completing inside a half typed quoted identifier replaces the quote too', async () => {
		// The editor's own idea of the word under the cursor stops at the quote, which would leave
		// the opening one behind and insert a second.
		const { list, document } = await complete('SELECT o."Order T| FROM orders o');

		assert.strictEqual(list.items[0].label, 'Order Total');
		assert.deepStrictEqual(extents(document, list.items[0]), ['"Order T', '"Order T']);
		assert.strictEqual(list.items[0].insertText, '"Order Total"');
	});

	test('an item inside a quoted identifier is filtered by what was typed, quote included', async () => {
		// The editor matches the text from the start of the edit -- the opening quote -- against
		// an item's filter text. Left as the bare label, `` `Ord `` would match nothing at all.
		const { list } = await complete('SELECT o.`Ord| FROM orders o', { dialect: 'mysql' });

		assert.deepStrictEqual(
			list.items.map(item => [item.label, item.filterText]),
			[['Order Total', '`Order Total']],
		);
	});

	test('a quote the editor closed as it was opened is replaced along with the opening one', async () => {
		// Typing `"` inserts `""`; a completion brings its own closing quote, so the one already
		// there would otherwise be left dangling after it.
		const { list, document } = await complete('SELECT o."Order T|" FROM orders o');

		assert.deepStrictEqual(extents(document, list.items[0]), ['"Order T"', '"Order T"']);
		assert.strictEqual(list.items[0].insertText, '"Order Total"');
	});

	test('a quote that opens an identifier asks for completions, and one that closes it does not', async () => {
		const opened = await complete('SELECT o.`| FROM orders o', { dialect: 'mysql', trigger: '`' });
		const closed = await complete('SELECT o.`Order Total`| FROM orders o', { dialect: 'mysql', trigger: '`' });

		assert.deepStrictEqual([opened.labels, closed.labels], [['id', 'total', 'Order Total'], []]);
	});

	test('a row count is offered no names', async () => {
		// A column there is a query that fails when it runs; MySQL calls it an undeclared variable.
		// No keyword either: PostgreSQL's `LIMIT ALL` is a syntax error in MySQL.
		const limit = await complete('SELECT o.id FROM orders o LIMIT |', { dialect: 'mysql' });
		const offset = await complete('SELECT o.id FROM orders o LIMIT 10 OFFSET |');

		assert.deepStrictEqual([limit.labels, offset.labels], [[], []]);
	});

	test('nothing is offered inside a string literal', async () => {
		assert.deepStrictEqual((await complete('SELECT \'some tex|')).labels, []);
	});

	test('nothing is offered inside a line comment', async () => {
		assert.deepStrictEqual((await complete('SELECT 1 -- a note|')).labels, []);
	});

	test('an empty document still offers keywords', async () => {
		const { list } = await complete('|');

		assert.ok(ofKind(list, vscode.CompletionItemKind.Keyword).includes('SELECT'));
	});

	test('an empty schema still offers keywords', async () => {
		const { list } = await complete('SELECT | FROM orders', { schema: new SchemaIndex() });

		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Class), []);
		assert.ok(ofKind(list, vscode.CompletionItemKind.Keyword).includes('DISTINCT'));
	});

	test('an unfiltered request offers one position\'s keywords, not the vocabulary', async () => {
		// Written out rather than compared against the analyzer, so that what a user sees in the
		// commonest position of all -- an empty document -- is legible here, and a change to it is
		// something a reviewer reads rather than something the assertion quietly follows.
		const { labels } = await complete('|', { schema: new SchemaIndex() });

		assert.deepStrictEqual(labels, [
			'ALTER TABLE', 'ALTER VIEW', 'ANALYZE', 'BEGIN', 'CALL', 'COMMIT', 'COPY', 'CREATE',
			'CREATE INDEX', 'CREATE MATERIALIZED VIEW', 'CREATE OR REPLACE VIEW', 'CREATE SCHEMA',
			'CREATE TABLE', 'CREATE TEMPORARY TABLE', 'CREATE VIEW', 'DELETE FROM', 'DESCRIBE',
			'DROP INDEX', 'DROP TABLE', 'DROP VIEW', 'EXECUTE', 'EXPLAIN', 'GRANT', 'INSERT INTO',
			'LISTEN', 'MERGE INTO', 'NOTIFY', 'PRAGMA', 'PREPARE', 'REVOKE', 'ROLLBACK', 'SELECT',
			'SET', 'SHOW', 'START TRANSACTION', 'TRUNCATE TABLE', 'UNLISTEN', 'UPDATE', 'USE',
			'VACUUM', 'VALUES', 'WITH', 'WITH RECURSIVE',
		]);
	});

	test('the keywords offered follow the cursor', async () => {
		// A table slot and a select list are offered nothing alike. Which keywords belong to which
		// position, across dialects, is pinned by the analyzer crate's own tests rather than here.
		const table = await complete('SELECT * FROM |', { schema: new SchemaIndex() });
		const selectList = await complete('SELECT |', { schema: new SchemaIndex() });

		assert.deepStrictEqual(table.labels, ['LATERAL', 'TABLE', 'UNNEST']);
		assert.ok(selectList.labels.includes('DISTINCT'), selectList.labels.join(', '));
		assert.ok(!selectList.labels.includes('UNNEST'), selectList.labels.join(', '));
	});

	test('a prefix that matches nothing falls back to the whole vocabulary', async () => {
		// `WHEN` belongs to a CASE arm, which the position classifier deliberately places nowhere.
		// The fallback is what keeps a keyword it does not place reachable anyway.
		const missed = await complete('SELECT CASE WHEN true THEN 1 WHE|');
		// Conditioned on nothing at all matching, so a prefix that does name something is answered
		// with that one thing rather than with the vocabulary dragged in behind it.
		const matched = await complete('SELECT * FROM ord|');

		assert.deepStrictEqual(missed.labels, ['WHEN', 'WHENEVER', 'WHERE']);
		assert.deepStrictEqual(matched.labels, ['orders']);
	});

	test('no keywords are offered inside a quoted identifier', async () => {
		// A quoted identifier is never a keyword, by the reasoning that already offers none after a
		// dot -- and the fallback does not reintroduce them when the prefix matches nothing.
		const { labels } = await complete('SELECT "sel| FROM orders');

		assert.deepStrictEqual(labels, []);
	});

	test('a long list is capped and marked incomplete', async () => {
		// Past the cap the editor is told to ask again with a longer prefix, rather than shown a
		// truncated list as though it were the whole answer.
		const many = schemaOf(...Array.from({ length: 6000 }, (_, at) => `table_${at}: id`));
		const { list } = await complete('SELECT * FROM |', { schema: many });

		assert.strictEqual(list.items.length, 5000);
		assert.strictEqual(list.isIncomplete, true);
	});
	test('only tables are offered where a table is read', async () => {
		const { list } = await complete('SELECT * FROM orders o JOIN |');

		assert.deepStrictEqual(
			[ofKind(list, vscode.CompletionItemKind.Field), ofKind(list, vscode.CompletionItemKind.Variable)],
			[[], []],
		);
		assert.deepStrictEqual(ofKind(list, vscode.CompletionItemKind.Class), ['orders', 'customers']);
	});

	test('only the target\'s columns are offered in an INSERT column list or an UPDATE SET', async () => {
		const insert = await complete('INSERT INTO orders (|)');
		const update = await complete('UPDATE customers SET |');

		assert.deepStrictEqual(
			[insert, update].map(({ list }) => [
				ofKind(list, vscode.CompletionItemKind.Field),
				ofKind(list, vscode.CompletionItemKind.Class),
			]),
			[[['id', 'total', 'Order Total'], []], [['id', 'name'], []]],
		);
	});

	test('the table an INSERT writes is offered tables, not columns', async () => {
		const { list } = await complete('INSERT INTO |');

		assert.deepStrictEqual(
			[ofKind(list, vscode.CompletionItemKind.Field), ofKind(list, vscode.CompletionItemKind.Class)],
			[[], ['orders', 'customers']],
		);
	});

	test('the VISUALISE part is offered the query\'s columns and no tables', async () => {
		const plain = await complete('SELECT * FROM orders VISUALISE |');
		const aliased = await complete('SELECT total AS amount FROM orders VISUALISE amount AS y DRAW |');

		assert.deepStrictEqual(
			[plain, aliased].map(({ list }) => [
				ofKind(list, vscode.CompletionItemKind.Field),
				ofKind(list, vscode.CompletionItemKind.Variable),
				ofKind(list, vscode.CompletionItemKind.Class),
			]),
			[[['id', 'total', 'Order Total'], [], []], [['id', 'total', 'Order Total'], ['amount'], []]],
		);
	});

	test('a column says which of the statement\'s tables it is of', async () => {
		const { list } = await complete('SELECT | FROM orders o JOIN customers ON true');

		assert.deepStrictEqual(
			list.items
				.filter(item => typeof item.label !== 'string' && item.label.label === 'id')
				.map(item => (item.label as vscode.CompletionItemLabel).description),
			['o', 'customers'],
		);
	});

	test('replacing in the middle of a word takes in the rest of it', async () => {
		const { list, document } = await complete('SELECT o.to|tal FROM orders o');

		assert.deepStrictEqual(extents(document, list.items[0]), ['to', 'total']);
	});

	test('completing in the middle of a quoted name replaces the whole name', async () => {
		const { list, document } = await complete('SELECT o."Ord|er Total" FROM orders o');

		assert.deepStrictEqual(
			[list.items[0].label, ...extents(document, list.items[0]), list.items[0].insertText],
			['Order Total', '"Order Total"', '"Order Total"', '"Order Total"'],
		);
	});

	test('a double quote typed into a BigQuery string asks for nothing', async () => {
		// It opens a string there, and accepting a column would replace the string with a name.
		const { labels } = await complete('SELECT * FROM orders WHERE name = "|"', { dialect: 'bigquery', trigger: '"' });

		assert.deepStrictEqual(labels, []);
	});

	test('a string with a backslash escaped quote ends where the dialect says', async () => {
		const mysql = await complete('SELECT * FROM orders o WHERE name = \'O\\\'Brien\' AND o.|', { dialect: 'mysql' });
		const postgres = await complete('SELECT * FROM orders o WHERE name = E\'O\\\'Brien\' AND o.|', { dialect: 'postgres' });

		assert.deepStrictEqual([mysql.labels, postgres.labels], [['id', 'total', 'Order Total'], ['id', 'total', 'Order Total']]);
	});

	test('nothing is completed in a MySQL hash comment', async () => {
		const { labels } = await complete('SELECT 1 # see o.|', { dialect: 'mysql' });

		assert.deepStrictEqual(labels, []);
	});

	test('a schema\'s names are asked about once in each dialect, not once per item', async () => {
		const real = testAnalyzer();
		let calls = 0;
		const counting = Object.create(real) as typeof real;
		counting.quoting = (names, dialect) => {
			calls++;
			return real.quoting(names, dialect);
		};
		const { log } = testLog();
		let dialect = 'duckdb';
		const provider = new SqlCompletionItemProvider(() => ({
			analyzer: counting, schema: SCHEMA, dialect, keywords: real.keywords(), log,
		}));
		const document = await sqlDocument('SELECT  FROM orders');
		const position = document.positionAt(7);

		provider.provideCompletionItems(document, position);
		dialect = 'postgres';
		calls = 0;
		provider.provideCompletionItems(document, position);

		assert.strictEqual(calls, 1);
	});

});

/**
 * The two empty-after-a-dot cases, which the editor draws identically -- no list at all -- and
 * which the log is the only place to tell apart.
 */
suite('explainEmptyQualifier', () => {

	/** A table with the given columns, as the connection reader produces one. */
	function table(name: string, ...columns: string[]): SqlTable {
		return {
			name,
			schema: 'sales',
			kind: 'table',
			columns: columns.map(column => ({ name: column })),
		};
	}

	test('a qualifier that named nothing says the user has to fix or connect something', () => {
		const message = explainEmptyQualifier('nothing', []);

		assert.ok(message.includes('"nothing"'), message);
		assert.ok(message.includes('alias'), message);
	});

	test('a qualifier that resolved to columnless tables names them and blames the read', () => {
		// The table is there and the user can see it in the Connections pane, so the answer is not
		// "no such table" but "the schema read stopped above its fields".
		const message = explainEmptyQualifier('orders', [table('orders')]);

		assert.ok(message.includes('sales.orders'), message);
		assert.ok(message.includes('no columns'), message);
	});
});
