/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { applyPwbPositAIDefault } from '../pwbDefaults';

function makeContext(): { context: vscode.ExtensionContext; globalState: Map<string, unknown> } {
	const globalState = new Map<string, unknown>();
	const context = {
		globalState: {
			get: <T>(key: string) => globalState.get(key) as T | undefined,
			update: (key: string, value: unknown) => {
				globalState.set(key, value);
				return Promise.resolve();
			},
		},
	} as unknown as vscode.ExtensionContext;
	return { context, globalState };
}

function writeConfig(configPath: string, providers: Record<string, unknown>): void {
	fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers }));
}

/**
 * Captures the levels applyPwbPositAIDefault logs at. Injected rather than
 * stubbed: the module-level `log` wraps a real output channel.
 */
function makeLogger() {
	const entries: { level: string; message: string }[] = [];
	const record = (level: string) => (message: string) => { entries.push({ level, message }); };
	return {
		entries,
		logger: { debug: record('debug'), info: record('info'), warn: record('warn') },
		messages: (level: string) => entries.filter(e => e.level === level).map(e => e.message),
	};
}

suite('applyPwbPositAIDefault', () => {
	let dir: string;
	let configPath: string;

	setup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwb-defaults-'));
		configPath = path.join(dir, 'providers.json');
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('does nothing when not on PWB', async () => {
		const { context, globalState } = makeContext();

		await applyPwbPositAIDefault(context, false, { configPath });

		assert.strictEqual(fs.existsSync(configPath), false);
		assert.strictEqual(globalState.size, 0);
	});

	test('does nothing when default already applied', async () => {
		const { context, globalState } = makeContext();
		globalState.set('positAI.pwbDefaultApplied', true);
		const { logger, messages } = makeLogger();

		await applyPwbPositAIDefault(context, true, { configPath }, logger);

		assert.strictEqual(fs.existsSync(configPath), false);
		// Debug, not info: this branch runs on every launch after the first.
		assert.match(messages('debug').join('\n'), /applied on an earlier run/);
		assert.deepStrictEqual(messages('info'), []);
	});

	test('disables positai in providers.json on first PWB run', async () => {
		const { context, globalState } = makeContext();
		const { logger, messages } = makeLogger();

		await applyPwbPositAIDefault(context, true, { configPath }, logger);

		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		assert.strictEqual(config.providers.positai.enabled, false);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
		const info = messages('info').join('\n');
		assert.match(info, /applied the Posit Workbench default/);
		assert.ok(info.includes(configPath), `expected the info log to name ${configPath}, got: ${info}`);
	});

	test('does not clobber an explicit enabled value in providers.json', async () => {
		const { context, globalState } = makeContext();
		writeConfig(configPath, { positai: { enabled: true } });
		const { logger, messages } = makeLogger();

		await applyPwbPositAIDefault(context, true, { configPath }, logger);

		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		assert.strictEqual(config.providers.positai.enabled, true);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
		const info = messages('info').join('\n');
		assert.match(info, /already set/);
		assert.doesNotMatch(info, /applied the Posit Workbench default/);
		assert.ok(info.includes(configPath), `expected the info log to name ${configPath}, got: ${info}`);
	});

	test('marks as applied even when the write fails', async () => {
		const { context, globalState } = makeContext();
		// A file in place of a directory segment makes `mkdir` fail, so the
		// providers.json write itself fails.
		const blocker = path.join(dir, 'blocker');
		fs.writeFileSync(blocker, 'not a directory');
		const unwritablePath = path.join(blocker, 'providers.json');
		const { logger, messages } = makeLogger();

		await applyPwbPositAIDefault(context, true, { configPath: unwritablePath }, logger);

		assert.strictEqual(fs.existsSync(unwritablePath), false);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
		const warnings = messages('warn').join('\n');
		assert.ok(
			warnings.includes(unwritablePath),
			`expected the warning to name ${unwritablePath}, got: ${warnings}`
		);
	});
});
