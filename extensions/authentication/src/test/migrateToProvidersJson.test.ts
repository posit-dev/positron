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
});
