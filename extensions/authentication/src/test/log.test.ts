/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BufferedLogOutputChannel } from '../log';

/**
 * Minimal stub of vscode.LogOutputChannel for testing.
 */
function createMockChannel() {
	const messages: { level: string; message: string }[] = [];
	return {
		messages,
		name: 'Test',
		logLevel: 2, // Info
		// eslint-disable-next-line local/code-no-any-casts
		onDidChangeLogLevel: (() => ({ dispose() { } })) as any,
		append: () => { },
		appendLine: () => { },
		replace: () => { },
		clear: () => { },
		show: () => { },
		hide: () => { },
		dispose: () => { },
		trace: (msg: string) => messages.push({ level: 'trace', message: msg }),
		debug: (msg: string) => messages.push({ level: 'debug', message: msg }),
		info: (msg: string) => messages.push({ level: 'info', message: msg }),
		warn: (msg: string) => messages.push({ level: 'warn', message: msg }),
		error: (msg: string | Error) => messages.push({
			level: 'error',
			message: msg instanceof Error ? msg.message : msg,
		}),
	};
}

suite('BufferedLogOutputChannel', () => {
	test('forwards messages to underlying channel', () => {
		const mock = createMockChannel();
		// eslint-disable-next-line local/code-no-any-casts
		const channel = new BufferedLogOutputChannel(mock as any);

		channel.info('hello');

		assert.strictEqual(mock.messages.length, 1);
		assert.strictEqual(mock.messages[0].level, 'info');
		assert.strictEqual(mock.messages[0].message, 'hello');
	});

	test('respects maxEntries circular buffer', () => {
		const mock = createMockChannel();
		// eslint-disable-next-line local/code-no-any-casts
		const channel = new BufferedLogOutputChannel(mock as any, 3);

		channel.info('one');
		channel.info('two');
		channel.info('three');
		channel.info('four');

		const output = channel.formatEntriesForDiagnostics();
		assert.ok(!output.includes('one'), 'oldest entry should be evicted');
		assert.ok(output.includes('two'));
		assert.ok(output.includes('three'));
		assert.ok(output.includes('four'));
	});

	test('formatEntriesForDiagnostics respects count parameter', () => {
		const mock = createMockChannel();
		// eslint-disable-next-line local/code-no-any-casts
		const channel = new BufferedLogOutputChannel(mock as any);

		channel.info('one');
		channel.info('two');
		channel.info('three');

		const output = channel.formatEntriesForDiagnostics(2);
		assert.ok(!output.includes('one'));
		assert.ok(output.includes('two'));
		assert.ok(output.includes('three'));
	});

	test('error with Error object includes message and stack', () => {
		const mock = createMockChannel();
		// eslint-disable-next-line local/code-no-any-casts
		const channel = new BufferedLogOutputChannel(mock as any);

		const err = new Error('test error');
		channel.error(err);

		const output = channel.formatEntriesForDiagnostics();
		assert.ok(output.includes('test error'));
		assert.ok(output.includes('Error: test error'));
	});

});
