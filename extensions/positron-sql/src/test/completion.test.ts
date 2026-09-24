/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { explainEmptyQualifier, SqlCompletionItemProvider } from '../completion';
import { SqlTable } from '../schema';
import { SchemaIndex } from '../schemaIndex';
import { schemaOf, sqlDocument, testAnalyzer, testLog } from './support';

const SCHEMA = schemaOf('sales.orders: id, total, Order Total', 'customers: id, name');

/**
 * Completes at the cursor, written as `|` in the text.
 *
 * Returns the labels, which is what the user reads in the list. What each item inserts is checked
 * separately, by the tests that are about insertion.
 */
async function complete(
	marked: string,
	options: { schema?: SchemaIndex; dialect?: string } = {},
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
	const list = provider.provideCompletionItems(document, document.positionAt(offset));
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

suite('SqlCompletionItemProvider', () => {

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

		assert.strictEqual(document.getText(list.items[0].textEdit!.range), 'cust');
	});

	test('an identifier needing quotes inserts quoted', async () => {
		const { list } = await complete('SELECT o.Order| FROM orders o');

		assert.strictEqual(list.items[0].label, 'Order Total');
		assert.strictEqual(list.items[0].textEdit!.newText, '"Order Total"');
	});

	test('the quote style follows the dialect', async () => {
		// Named as the setting and the connection drivers name them: `tsql`, not sqlparser's
		// `mssql`, which is a spelling no dialect ever arrives here under.
		const backticks = await complete('SELECT o.Order| FROM orders o', { dialect: 'mysql' });
		const brackets = await complete('SELECT o.Order| FROM orders o', { dialect: 'tsql' });

		assert.strictEqual(backticks.list.items[0].textEdit!.newText, '`Order Total`');
		assert.strictEqual(brackets.list.items[0].textEdit!.newText, '[Order Total]');
	});

	test('completing inside a half typed quoted identifier replaces the quote too', async () => {
		// The editor's own idea of the word under the cursor stops at the quote, which would leave
		// the opening one behind and insert a second.
		const { list, document } = await complete('SELECT o."Order T| FROM orders o');

		assert.strictEqual(list.items[0].label, 'Order Total');
		assert.strictEqual(document.getText(list.items[0].textEdit!.range), '"Order T');
		assert.strictEqual(list.items[0].textEdit!.newText, '"Order Total"');
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
			'MERGE INTO', 'PRAGMA', 'PREPARE', 'REVOKE', 'ROLLBACK', 'SELECT', 'SET', 'SHOW',
			'START TRANSACTION', 'TRUNCATE TABLE', 'UPDATE', 'USE', 'VACUUM', 'VALUES', 'WITH',
			'WITH RECURSIVE',
		]);
	});

	test('the keywords offered follow the cursor', async () => {
		// A table slot and a select list are offered nothing alike. Which keywords belong to which
		// position, across dialects, is pinned by the analyzer crate's own tests rather than here.
		const table = await complete('SELECT * FROM |', { schema: new SchemaIndex() });
		const selectList = await complete('SELECT |', { schema: new SchemaIndex() });

		assert.deepStrictEqual(table.labels, ['IF EXISTS', 'IF NOT EXISTS', 'LATERAL', 'TABLE', 'UNNEST']);
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
