/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { parseActivationLog } from './extensions.js';

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

	test('parses the captured real exthost log', () => {
		const fixture = readFileSync(join(__dirname, 'fixtures', 'exthost.log'), 'utf8');
		const parsed = parseActivationLog(fixture);
		expect(parsed.length).toBeGreaterThan(10);
		expect(parsed.map(e => e.extensionId)).toContain('positron.positron-r');
		expect(parsed.every(e => e.extensionId.length > 0 && e.activationEvent)).toBe(true);
	});
});
