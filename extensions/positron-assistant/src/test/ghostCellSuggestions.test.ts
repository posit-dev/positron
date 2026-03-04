/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { parseStreamingXML } from '../ghostCellSuggestions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLog(): vscode.LogOutputChannel {
	return {
		debug: () => { },
		info: () => { },
		warn: () => { },
		error: () => { },
		trace: () => { },
	} as unknown as vscode.LogOutputChannel;
}

function iterableFrom(chunks: string[]): AsyncIterable<string> {
	return {
		[Symbol.asyncIterator]: async function* () {
			for (const chunk of chunks) {
				yield chunk;
			}
		}
	};
}

/**
 * Create an async iterable that yields some chunks then stalls forever.
 * Call `cleanup` to unblock so the iterator can be garbage-collected.
 */
function stallingIterable(chunks: string[]): { iterable: AsyncIterable<string>; cleanup: () => void } {
	let unblock: () => void;
	const blockForever = new Promise<string>((resolve) => {
		unblock = () => resolve('');
	});
	return {
		iterable: {
			[Symbol.asyncIterator]: async function* () {
				for (const chunk of chunks) {
					yield chunk;
				}
				yield await blockForever;
			}
		},
		cleanup: () => unblock!()
	};
}

// ---------------------------------------------------------------------------
// parseStreamingXML
// ---------------------------------------------------------------------------

suite('parseStreamingXML', () => {
	const log = mockLog();

	test('parses a complete suggestion', async () => {
		const xml = '<suggestion><explanation>Load the data</explanation><code>import pandas as pd\ndf = pd.read_csv("data.csv")</code></suggestion>';
		const stream = iterableFrom([xml]);
		const cts = new vscode.CancellationTokenSource();

		const result = await parseStreamingXML(stream, log, cts.token, 'python');
		cts.dispose();

		assert.ok(result);
		assert.strictEqual(result.code, 'import pandas as pd\ndf = pd.read_csv("data.csv")');
		assert.strictEqual(result.explanation, 'Load the data');
		assert.strictEqual(result.language, 'python');
	});

	test('cancellation unblocks a stalled iterator', async () => {
		// Key behavioral test for the PR fix: if the iterator stalls
		// (never yields), cancellation should still return promptly.
		const { iterable, cleanup } = stallingIterable([]);
		const cts = new vscode.CancellationTokenSource();

		const start = Date.now();
		setTimeout(() => cts.cancel(), 50);

		const result = await parseStreamingXML(iterable, log, cts.token, 'python');
		const elapsed = Date.now() - start;
		cleanup();
		cts.dispose();

		assert.strictEqual(result, null);
		assert.ok(elapsed < 2000, `Expected prompt return after cancellation but took ${elapsed}ms`);
	});

	test('handles iterator whose return() stalls', async () => {
		// If iterator.return() hangs, parseStreamingXML should not
		// block indefinitely thanks to the cleanup timeout.
		let returnCalled = false;
		const iterable: AsyncIterable<string> = {
			[Symbol.asyncIterator]() {
				let done = false;
				return {
					async next() {
						if (!done) {
							done = true;
							return { value: '<suggestion><code>x</code></suggestion>', done: false };
						}
						return { value: undefined, done: true };
					},
					return() {
						returnCalled = true;
						return new Promise<IteratorResult<string>>(() => { });
					}
				};
			}
		};

		const cts = new vscode.CancellationTokenSource();
		const start = Date.now();
		setTimeout(() => cts.cancel(), 50);

		const result = await parseStreamingXML(iterable, log, cts.token, 'python');
		const elapsed = Date.now() - start;
		cts.dispose();

		assert.strictEqual(returnCalled, true, 'iterator.return() should have been called');
		// The 1000ms ITERATOR_CLEANUP_TIMEOUT_MS + some margin
		assert.ok(elapsed < 3000, `Expected cleanup timeout to fire but took ${elapsed}ms`);
	});
});
