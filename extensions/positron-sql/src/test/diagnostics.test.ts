/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { collectDiagnostics } from '../diagnostics';
import { SchemaIndex } from '../schemaIndex';
import { partialPayloadOf, schemaOf, sqlDocument, testAnalyzer } from './support';

const SCHEMA = schemaOf('sales.orders: id, total', 'customers: id, name');

/** The diagnostics for a document, as `severity "text under the squiggle": message`. */
async function report(
	text: string,
	schema: SchemaIndex = SCHEMA,
	reportUnknownNames = true,
): Promise<string[]> {
	const document = await sqlDocument(text);
	const analysis = testAnalyzer().analyze(text, '');
	return collectDiagnostics(document, analysis, schema, reportUnknownNames).map(diagnostic => {
		const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
		return `${severity} "${document.getText(diagnostic.range)}": ${diagnostic.message}`;
	});
}

suite('collectDiagnostics', () => {

	test('valid SQL against a known schema has no diagnostics', async () => {
		assert.deepStrictEqual(await report('SELECT total FROM orders'), []);
	});

	test('a syntax error is an error on the offending token', async () => {
		assert.deepStrictEqual(
			await report('SELECT * FRM orders'),
			['error "FRM": Expected: end of statement, found: FRM.'],
		);
	});

	test('an unknown table is a warning on its name, and names where it was looked for', async () => {
		assert.deepStrictEqual(
			await report('SELECT * FROM invoices'),
			[`warning "invoices": No table named 'invoices' in Test Connection.`],
		);
	});

	test('an unknown column names the table it is not in', async () => {
		assert.deepStrictEqual(
			await report('SELECT quantity FROM orders'),
			[`warning "quantity": No column named 'quantity' in sales.orders.`],
		);
	});

	test('an unknown column names every table it was looked for in', async () => {
		assert.deepStrictEqual(
			await report('SELECT quantity FROM orders, customers'),
			[`warning "quantity": No column named 'quantity' in sales.orders, customers.`],
		);
	});

	test('a syntax error stays an error even with a schema to check against', async () => {
		// The two kinds are independent: an unparseable statement still reports its syntax.
		const reported = await report('SELECT * FRM invoices');

		assert.strictEqual(reported.length, 1);
		assert.ok(reported[0].startsWith('error '));
	});

	test('nothing is reported without a schema', async () => {
		// Nothing is connected, so a name the schema does not have says nothing about the name.
		assert.deepStrictEqual(await report('SELECT quantity FROM invoices', new SchemaIndex()), []);
	});

	test('nothing is reported from a schema that was read only in part', async () => {
		const partial = new SchemaIndex(partialPayloadOf('orders: id'));

		assert.deepStrictEqual(await report('SELECT quantity FROM invoices', partial), []);
	});

	test('the setting turns unknown names off without touching syntax errors', async () => {
		assert.deepStrictEqual(await report('SELECT * FROM invoices', SCHEMA, false), []);
		assert.strictEqual((await report('SELECT * FRM orders', SCHEMA, false)).length, 1);
	});

	test('every statement in a document is checked', async () => {
		assert.deepStrictEqual(
			await report('SELECT * FROM invoices;\nSELECT * FROM receipts'),
			[
				`warning "invoices": No table named 'invoices' in Test Connection.`,
				`warning "receipts": No table named 'receipts' in Test Connection.`,
			],
		);
	});

	test('diagnostics carry a source, so the Problems panel says where they came from', async () => {
		const document = await sqlDocument('SELECT * FRM orders');
		const analysis = testAnalyzer().analyze(document.getText(), '');

		for (const diagnostic of collectDiagnostics(document, analysis, SCHEMA, true)) {
			assert.strictEqual(diagnostic.source, 'sql');
		}
	});
});
