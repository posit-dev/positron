/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { findExtHostLog, parseActivationLog } from './extensions.js';

const line = (id: string, startup: boolean, event: string, rootCause?: string): string =>
	`2026-08-10 12:48:59.813 [info] ExtensionService#_doActivateExtension ${id}, startup: ${startup}, activationEvent: '${event}'${rootCause ? `, root cause: ${rootCause}` : ''}`;

describe('parseActivationLog', () => {
	test('reads the extension id and activation event', () => {
		const parsed = parseActivationLog(line('positron.positron-r', false, 'onStartupFinished'));
		expect(parsed).toEqual([{
			extensionId: 'positron.positron-r',
			isBuiltin: true,
			activationTimeMs: null,
			activationEvent: 'onStartupFinished'
		}]);
	});

	test('keeps the root cause suffix out of the activation event', () => {
		const parsed = parseActivationLog(line('positron.authentication', false, 'onAiEnabled', 'positron.next-edit-suggestions'));
		expect(parsed[0].activationEvent).toBe('onAiEnabled');
	});

	test('handles a wildcard activation event', () => {
		expect(parseActivationLog(line('vscode.git-base', false, '*')).at(0)?.activationEvent).toBe('*');
	});

	test('reports an extension once even if activation is logged repeatedly', () => {
		const text = [line('ms-python.python', false, 'onLanguage:python'), line('ms-python.python', false, 'onCommand:python.execInTerminal')].join('\n');
		const parsed = parseActivationLog(text);
		expect(parsed).toHaveLength(1);
		// The first activation is the one that cost the memory.
		expect(parsed[0].activationEvent).toBe('onLanguage:python');
	});

	test('ignores log lines that are not activations', () => {
		const text = ['2026-08-10 12:48:58.000 [info] Eager extensions activated', line('vscode.git', false, '*')].join('\n');
		expect(parseActivationLog(text).map(e => e.extensionId)).toEqual(['vscode.git']);
	});

	test('returns an empty list for an empty log rather than throwing', () => {
		expect(parseActivationLog('')).toEqual([]);
	});

	test('treats an id found in the user extensions dir as not builtin', () => {
		const text = [line('vscode.git', false, '*'), line('someone.custom-ext', false, 'onStartupFinished')].join('\n');
		const parsed = parseActivationLog(text, new Set(['someone.custom-ext']));
		expect(parsed.find(e => e.extensionId === 'someone.custom-ext')?.isBuiltin).toBe(false);
		expect(parsed.find(e => e.extensionId === 'vscode.git')?.isBuiltin).toBe(true);
	});

	test('matches installed ids case-insensitively', () => {
		// The extensions dir lowercases directory names; the log reports the id as
		// package.json declares it. A case-sensitive lookup marks every GitHub.*
		// and Posit.* extension builtin.
		const text = [line('GitHub.copilot-chat', false, 'onStartup'), line('Posit.air-vscode', false, 'onLanguage:r')].join('\n');
		const parsed = parseActivationLog(text, new Set(['github.copilot-chat', 'posit.air-vscode']));
		expect(parsed.map(e => e.isBuiltin)).toEqual([false, false]);
	});

	test('preserves the id as logged, even when matching lowercased', () => {
		const parsed = parseActivationLog(line('GitHub.copilot-chat', false, 'onStartup'), new Set(['github.copilot-chat']));
		expect(parsed[0].extensionId).toBe('GitHub.copilot-chat');
	});

	test('parses the captured real exthost log', () => {
		const fixture = readFileSync(join(__dirname, 'fixtures', 'exthost.log'), 'utf8');
		const parsed = parseActivationLog(fixture);
		expect(parsed.length).toBeGreaterThan(10);
		expect(parsed.map(e => e.extensionId)).toContain('positron.positron-r');
		expect(parsed.every(e => e.extensionId.length > 0 && e.activationEvent)).toBe(true);
	});
});

describe('findExtHostLog', () => {
	const layout = (...segments: string[]): string => {
		const root = mkdtempSync(join(tmpdir(), 'memory-logs-'));
		const dir = join(root, ...segments);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'exthost.log'), 'log');
		return root;
	};

	test('finds the log when the root is the session dir, as --logsPath makes it', async () => {
		const root = layout('window1', 'exthost');
		expect(await findExtHostLog(root)).toBe(join(root, 'window1', 'exthost', 'exthost.log'));
	});

	test('finds the log below a timestamped session dir, as a default launch makes it', async () => {
		const root = layout('20260810T124853', 'window1', 'exthost');
		expect(await findExtHostLog(root)).toBe(join(root, '20260810T124853', 'window1', 'exthost', 'exthost.log'));
	});

	test('prefers the newest session and the newest window', async () => {
		const root = layout('20260810T100000', 'window1', 'exthost');
		mkdirSync(join(root, '20260810T235959', 'window2', 'exthost'), { recursive: true });
		writeFileSync(join(root, '20260810T235959', 'window2', 'exthost', 'exthost.log'), 'log');
		expect(await findExtHostLog(root)).toBe(join(root, '20260810T235959', 'window2', 'exthost', 'exthost.log'));
	});

	test('returns undefined rather than throwing when the root does not exist', async () => {
		expect(await findExtHostLog(join(tmpdir(), 'memory-logs-does-not-exist'))).toBeUndefined();
	});

	test('picks window10 over window9, which a string sort gets backwards', async () => {
		const root = layout('window9', 'exthost');
		mkdirSync(join(root, 'window10', 'exthost'), { recursive: true });
		writeFileSync(join(root, 'window10', 'exthost', 'exthost.log'), 'log');
		expect(await findExtHostLog(root)).toBe(join(root, 'window10', 'exthost', 'exthost.log'));
	});

	test('ignores a non-session dir that sorts after the real session', async () => {
		const root = layout('20260810T124853', 'window1', 'exthost');
		mkdirSync(join(root, 'zzz-scratch'), { recursive: true });
		expect(await findExtHostLog(root)).toBe(join(root, '20260810T124853', 'window1', 'exthost', 'exthost.log'));
	});
});
