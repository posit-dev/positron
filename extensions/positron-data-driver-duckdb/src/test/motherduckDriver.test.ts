/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { DuckDBDataExplorerRpcHandler } from 'positron-data-explorer-duckdb';
import { createMotherDuckDriver } from '../motherduckDriver.js';

suite('MotherDuck Driver', () => {
	// The driver reads only the extension path (for its icon); no connection is opened.
	function createDriver(): positron.DataConnectionDriver {
		const extension = vscode.extensions.getExtension('positron.positron-data-driver-duckdb');
		assert.ok(extension, 'the DuckDB driver extension should be present');
		const context = { extensionPath: extension.extensionPath } as vscode.ExtensionContext;
		return createMotherDuckDriver(context, {} as DuckDBDataExplorerRpcHandler);
	}

	test('driver metadata', () => {
		const driver = createDriver();
		assert.deepStrictEqual(
			{
				id: driver.id,
				name: driver.name,
				languages: driver.supportedLanguageIds,
				mechanisms: driver.mechanisms.map(m => m.id),
				parameters: driver.mechanisms[0].parameters.map(p => p.id),
				tokenSecret: (driver.mechanisms[0].parameters[0] as { secret?: boolean }).secret,
				readOnlyDefault: (driver.mechanisms[0].parameters[2] as { defaultValue?: boolean }).defaultValue,
				hasIcon: !!driver.iconSvg && driver.iconSvg.includes('<svg'),
			},
			{
				id: 'positron-data-driver-motherduck',
				name: 'MotherDuck',
				languages: process.platform === 'win32' ? ['python', 'ggsql'] : ['python', 'r', 'ggsql'],
				mechanisms: ['token'],
				parameters: ['token', 'database', 'readOnly'],
				tokenSecret: true,
				readOnlyDefault: true,
				hasIcon: true,
			}
		);
	});

	test('connect rejects a blank token without opening', async () => {
		const driver = createDriver();
		const start = Date.now();
		await assert.rejects(async () => driver.connect('token', { token: '  ' }), /A MotherDuck access token is required\./);
		await assert.rejects(async () => driver.connect('token', {}), /A MotherDuck access token is required\./);
		assert.ok(Date.now() - start < 2000);
	});

	test('connect rejects a default database with connection options without opening', async () => {
		const driver = createDriver();
		const start = Date.now();
		for (const database of ['mydb?attach_mode=single', 'a#b']) {
			await assert.rejects(async () => driver.connect('token', { token: 'aaa.bbb.ccc', database }),
				/The default database name cannot contain '\?' or '#'\./);
		}
		assert.ok(Date.now() - start < 2000);
	});

	test('generateConnectionCode delegates for ggsql', async () => {
		const variants = await createDriver().generateConnectionCode!('token', 'ggsql',
			{ token: 'aaa.bbb.ccc', database: 'sample_data', readOnly: true });
		assert.deepStrictEqual(variants, [
			{ id: 'ggsql', label: 'ggsql', code: '-- @connect: duckdb://md:sample_data?motherduck_token=aaa.bbb.ccc' },
		]);
	});

	test('generateConnectionCode omits the token when secrets are left out', async () => {
		const variants = await createDriver().generateConnectionCode!('token', 'ggsql',
			{ database: 'sample_data', readOnly: true });
		assert.strictEqual(variants[0].code, '-- @connect: duckdb://md:sample_data');
	});

	test('generateConnectionCode returns nothing for an unknown mechanism', async () => {
		const variants = await createDriver().generateConnectionCode!('other', 'python', { token: 'aaa.bbb.ccc' });
		assert.deepStrictEqual(variants, []);
	});
});
