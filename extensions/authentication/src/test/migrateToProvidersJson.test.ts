/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	hasMigratableSettings,
	runMigration,
	userProvidersFileIsPopulated,
} from '../migration/migrateToProvidersJson';
import { MigrationSettingsReader } from '../migration/providersJson';

function readerOf(values: Record<string, unknown>): MigrationSettingsReader {
	return { globalValue: <T,>(key: string) => values[key] as T | undefined };
}

suite('migrateToProvidersJson', () => {
	let dir: string;
	let configPath: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'providers-json-migration-'));
		configPath = path.join(dir, 'providers.json');
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('hasMigratableSettings is false for empty settings and true for any migratable key', () => {
		assert.strictEqual(hasMigratableSettings(readerOf({})), false);
		assert.strictEqual(hasMigratableSettings(readerOf({ 'authentication.anthropic.baseUrl': 'https://x' })), true);
	});

	test('hasMigratableSettings is false when only empty values are set', () => {
		assert.strictEqual(hasMigratableSettings(readerOf({
			'authentication.anthropic.baseUrl': '',
			'authentication.anthropic.customHeaders': {},
		})), false);
	});

	test('nothing to migrate leaves no file behind', async () => {
		const result = await runMigration({ overwrite: false, configPath, reader: readerOf({}) });
		assert.deepStrictEqual(result, { outcome: 'nothing-to-migrate' });
		assert.strictEqual(fs.existsSync(configPath), false);
	});

	test('first migration writes the mapped config with seed metadata', async () => {
		const result = await runMigration({
			overwrite: false,
			configPath,
			reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://gateway.example.com' }),
		});
		assert.deepStrictEqual(result, { outcome: 'migrated', settingCount: 1 });
		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.baseUrl, 'https://gateway.example.com');
		assert.strictEqual(written.version, 1);
		assert.strictEqual(await userProvidersFileIsPopulated(configPath), true);
	});

	test('a populated file is skipped without overwrite', async () => {
		await runMigration({ overwrite: false, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://first' }) });
		const result = await runMigration({ overwrite: false, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://second' }) });
		assert.deepStrictEqual(result, { outcome: 'skipped-populated' });
		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.baseUrl, 'https://first');
	});

	test('overwrite replaces the providers block', async () => {
		await runMigration({ overwrite: false, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://first' }) });
		const result = await runMigration({
			overwrite: true,
			configPath,
			reader: readerOf({ 'authentication.openai-api.baseUrl': 'https://second' }),
		});
		assert.deepStrictEqual(result, { outcome: 'migrated', settingCount: 1 });
		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic, undefined);
		assert.strictEqual(written.providers.openai.baseUrl, 'https://second');
	});

	test('userProvidersFileIsPopulated is false for a missing file', async () => {
		assert.strictEqual(await userProvidersFileIsPopulated(configPath), false);
	});

	test('an unparseable providers.json counts as populated and is never overwritten', async () => {
		fs.writeFileSync(configPath, '{ this is not JSON');
		assert.strictEqual(await userProvidersFileIsPopulated(configPath), true);
		const result = await runMigration({ overwrite: false, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://x' }) });
		assert.deepStrictEqual(result, { outcome: 'skipped-populated' });
		assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), '{ this is not JSON');
	});

	test('a schema-invalid providers.json counts as populated and is never overwritten', async () => {
		const invalid = JSON.stringify({ unknownKey: true });
		fs.writeFileSync(configPath, invalid);
		assert.strictEqual(await userProvidersFileIsPopulated(configPath), true);
		const result = await runMigration({ overwrite: false, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://x' }) });
		assert.deepStrictEqual(result, { outcome: 'skipped-populated' });
		assert.strictEqual(fs.readFileSync(configPath, 'utf-8'), invalid);
	});

	test('a valid file without providers is not populated', async () => {
		fs.writeFileSync(configPath, JSON.stringify({ version: 1 }));
		assert.strictEqual(await userProvidersFileIsPopulated(configPath), false);
	});

	test('overwrite replaces even an unparseable file after explicit confirmation', async () => {
		fs.writeFileSync(configPath, '{ this is not JSON');
		const result = await runMigration({ overwrite: true, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://x' }) });
		assert.deepStrictEqual(result, { outcome: 'migrated', settingCount: 1 });
		const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		assert.strictEqual(written.providers.anthropic.baseUrl, 'https://x');
	});

	test('skipping a populated file does not rewrite it', async () => {
		await runMigration({ overwrite: false, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://first' }) });
		const before = fs.statSync(configPath).mtimeMs;
		await runMigration({ overwrite: false, configPath, reader: readerOf({ 'authentication.anthropic.baseUrl': 'https://second' }) });
		assert.strictEqual(fs.statSync(configPath).mtimeMs, before);
	});
});
