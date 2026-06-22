/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import * as assert from 'assert';
import { McpStdioStateHandler } from '../../node/mcpStdioStateHandler.js';
import { isWindows } from '../../../../../base/common/platform.js';

const GRACE_TIME = 100;

suite('McpStdioStateHandler', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function run(code: string) {
		const child = spawn('node', ['-e', code], {
			stdio: 'pipe',
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		});

		return {
			child,
			handler: store.add(new McpStdioStateHandler(child, GRACE_TIME)),
			processId: new Promise<number>((resolve) => {
				child.on('spawn', () => resolve(child.pid!));
			}),
			output: new Promise<string>((resolve, reject) => {
				let output = '';
				child.stderr.setEncoding('utf-8').on('data', (data) => {
					output += data.toString();
				});
				child.stdout.setEncoding('utf-8').on('data', (data) => {
					output += data.toString();
				});
				child.on('error', reject);
				child.on('close', () => resolve(output));
			}),
		};
	}

	test('stdin ends process', async () => {
		const { child, handler, output } = run(`
			const data = require('fs').readFileSync(0, 'utf-8');
			process.stdout.write('Data received: ' + data);
			process.on('SIGTERM', () => process.stdout.write('SIGTERM received'));
		`);

		await new Promise<void>(r => child.stdin.write('Hello MCP!', () => r()));
		handler.stop();
		const result = await output;
		assert.strictEqual(result.trim(), 'Data received: Hello MCP!');
	});

	if (!isWindows) {
		// --- Start Positron ---
		// Skipped: flaky on Linux. The test depends on a tight 100ms
		// shutdown-grace window and fails intermittently upstream on bare
		// Linux CI as well (microsoft/vscode#253370; #255289 "fails on OSS
		// Linux build"). It surfaced in our containerized unit-test job.
		// Re-enable if the upstream timing is hardened.
		test.skip('sigterm after grace', async () => {
			// --- End Positron ---
			const { handler, output } = run(`
			setInterval(() => {}, 1000);
			process.stdin.on('end', () => process.stdout.write('stdin ended\\n'));
			process.stdin.resume();
			process.on('SIGTERM', () => {
				process.stdout.write('SIGTERM received', () => {
					process.stdout.end(() => process.exit(0));
				});
			});
		`);

			const before = Date.now();
			handler.stop();
			const result = await output;
			const delay = Date.now() - before;
			assert.strictEqual(result.trim(), 'stdin ended\nSIGTERM received');
			assert.ok(delay >= GRACE_TIME, `Expected at least ${GRACE_TIME}ms delay, got ${delay}ms`);
		});
	}

	// --- Start Positron ---
	// Skipped: same Linux flakiness as 'sigterm after grace' above. The
	// non-Windows assertion depends on the child's SIGTERM output being
	// captured within the shutdown-grace window, which is intermittent on
	// Linux (microsoft/vscode#253370; #255289). Re-enable if upstream hardens.
	test.skip('sigkill after grace', async () => {
		// --- End Positron ---
		const { handler, output } = run(`
			setInterval(() => {}, 1000);
			process.stdin.on('end', () => process.stdout.write('stdin ended\\n'));
			process.stdin.resume();
			process.on('SIGTERM', () => {
				process.stdout.write('SIGTERM received');
			});
		`);

		const before = Date.now();
		handler.stop();
		const result = await output;
		const delay = Date.now() - before;
		if (!isWindows) {
			assert.strictEqual(result.trim(), 'stdin ended\nSIGTERM received');
		} else {
			assert.strictEqual(result.trim(), 'stdin ended');
		}
		assert.ok(delay >= GRACE_TIME * 2, `Expected at least ${GRACE_TIME * 2}ms delay, got ${delay}ms`);
	});
});
