/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildDatabaseOptions, parseDriverOptions, redactDriverOptions, redactUri } from '../adbcDriver.js';

suite('ADBC Driver Tests', () => {
	suite('parseDriverOptions', () => {
		test('parses semicolon- and newline-separated key=value pairs', () => {
			assert.deepStrictEqual(
				parseDriverOptions('adbc.snowflake.sql.account=acct; adbc.snowflake.sql.warehouse=wh\nfoo=bar'),
				{
					'adbc.snowflake.sql.account': 'acct',
					'adbc.snowflake.sql.warehouse': 'wh',
					'foo': 'bar',
				});
		});

		test('keeps "=" inside a value, splitting only on the first one', () => {
			// Base64-encoded tokens routinely end in padding '='.
			assert.deepStrictEqual(parseDriverOptions('token=YWJjZA=='), { token: 'YWJjZA==' });
		});

		test('ignores blank and malformed entries', () => {
			assert.deepStrictEqual(parseDriverOptions(';;a=1;garbage;;=novalue;'), { a: '1' });
		});

		test('returns nothing for an empty string', () => {
			assert.deepStrictEqual(parseDriverOptions(''), {});
		});
	});

	suite('buildDatabaseOptions', () => {
		test('maps the dedicated fields onto the ADBC standard option names', () => {
			assert.deepStrictEqual(
				buildDatabaseOptions({ uri: 'grpc://host:1234', username: 'u', password: 'p' }),
				{ uri: 'grpc://host:1234', username: 'u', password: 'p' });
		});

		test('merges the free-form options with the dedicated fields', () => {
			assert.deepStrictEqual(
				buildDatabaseOptions({ options: 'adbc.foo=bar', uri: 'grpc://host' }),
				{ 'adbc.foo': 'bar', uri: 'grpc://host' });
		});

		test('lets a dedicated field win over the same key in the options blob', () => {
			assert.deepStrictEqual(
				buildDatabaseOptions({ options: 'uri=from-options', uri: 'from-field' }),
				{ uri: 'from-field' });
		});

		test('omits blank fields rather than sending empty options', () => {
			assert.deepStrictEqual(buildDatabaseOptions({ uri: '', username: '', password: '' }), {});
		});
	});

	suite('redactDriverOptions', () => {
		test('masks values whose keys look sensitive and leaves the rest readable', () => {
			assert.strictEqual(
				redactDriverOptions('adbc.snowflake.sql.account=acct;password=hunter2;api_token=abc;region=us-east-1'),
				'adbc.snowflake.sql.account=acct;password=****;api_token=****;region=us-east-1');
		});

		test('preserves the original separators', () => {
			assert.strictEqual(redactDriverOptions('a=1\nsecret=x;b=2'), 'a=1\nsecret=****;b=2');
		});

		test('leaves an options string with nothing sensitive unchanged', () => {
			assert.strictEqual(redactDriverOptions('a=1;b=2'), 'a=1;b=2');
		});
	});

	suite('redactUri', () => {
		test('masks an embedded password', () => {
			assert.strictEqual(redactUri('postgresql://user:hunter2@host:5432/db'), 'postgresql://user:****@host:5432/db');
		});

		test('leaves a URI without a password unchanged', () => {
			assert.strictEqual(redactUri('grpc://localhost:31337'), 'grpc://localhost:31337');
		});

		test('leaves a value that is not a URI unchanged', () => {
			assert.strictEqual(redactUri('not a uri'), 'not a uri');
		});
	});
});
