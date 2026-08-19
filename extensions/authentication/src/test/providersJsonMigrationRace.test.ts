/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { runMigration } from '../migration/migrateToProvidersJson';
import { applyPwbPositAIDefault } from '../pwbDefaults';

function makeContext(): vscode.ExtensionContext {
	const globalState = new Map<string, unknown>();
	return {
		globalState: {
			get: <T>(key: string) => globalState.get(key) as T | undefined,
			update: (key: string, value: unknown) => {
				globalState.set(key, value);
				return Promise.resolve();
			},
		},
	} as unknown as vscode.ExtensionContext;
}

const LEGACY_SETTINGS: Record<string, unknown> = {
	'positron.assistant.provider.amazonBedrock.enable': true,
	'positron.assistant.provider.positAI.enable': false,
};

/**
 * `applyPwbPositAIDefault` writes `positai` into the same providers.json, so a
 * migration that has not finished writing first sees a populated `providers`
 * block and skips for good.
 */
suite('providers.json migration vs the PWB Posit AI default', () => {
	let dir: string;
	let configPath: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-race-'));
		configPath = path.join(dir, 'providers.json');
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('an awaited migration writes every provider before the PWB default runs', async () => {
		await runMigration({
			overwrite: false,
			configPath,
			reader: { globalValue: <T,>(key: string) => LEGACY_SETTINGS[key] as T | undefined },
		});
		await applyPwbPositAIDefault(makeContext(), true, { configPath });

		const providers = JSON.parse(fs.readFileSync(configPath, 'utf8')).providers;
		assert.deepStrictEqual(
			{ bedrock: providers.bedrock?.enabled, positai: providers.positai?.enabled },
			{ bedrock: true, positai: false },
			'the migrated Bedrock block must survive the PWB default'
		);
	});

	test('the PWB default winning the race blocks the migration', async () => {
		await applyPwbPositAIDefault(makeContext(), true, { configPath });

		const result = await runMigration({
			overwrite: false,
			configPath,
			reader: { globalValue: <T,>(key: string) => LEGACY_SETTINGS[key] as T | undefined },
		});

		assert.strictEqual(result.outcome, 'skipped-populated');
		assert.strictEqual(
			JSON.parse(fs.readFileSync(configPath, 'utf8')).providers.bedrock,
			undefined,
			'this is the data loss the awaited ordering prevents'
		);
	});
});
