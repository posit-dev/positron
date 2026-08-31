/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { UnsavedScriptFiles } from '../unsavedScripts';

function fakeUntitled(name: string, text: string): vscode.TextDocument {
	return {
		uri: vscode.Uri.parse(`untitled:${name}`),
		isUntitled: true,
		getText: () => text,
	} as unknown as vscode.TextDocument;
}

suite('UnsavedScriptFiles', () => {
	let tmpDir: string;
	let manager: UnsavedScriptFiles;

	suiteSetup(async () => {
		// Canonicalize: the manager resolves symlinks (e.g. macOS /var -> /private/var).
		tmpDir = fs.realpathSync(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'positron-unsaved-test-')));
		await vscode.workspace.getConfiguration('interpreters')
			.update('unsavedScriptsDirectory', tmpDir, vscode.ConfigurationTarget.Global);
	});

	suiteTeardown(async () => {
		await vscode.workspace.getConfiguration('interpreters')
			.update('unsavedScriptsDirectory', undefined, vscode.ConfigurationTarget.Global);
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	setup(() => { manager = new UnsavedScriptFiles(); });
	teardown(() => manager.dispose());

	test('writes the buffer to a hidden scratch file, then deletes it when the run finishes', async () => {
		const filePath = await manager.write(fakeUntitled('Untitled-1', 'cat("hi")'));

		assert.strictEqual(path.dirname(filePath), tmpDir);
		assert.strictEqual(path.basename(filePath), '.positron-untitled-1.R');
		assert.strictEqual(await fs.promises.readFile(filePath, 'utf8'), 'cat("hi")');

		await manager.finished(filePath);
		assert.ok(!fs.existsSync(filePath));
	});

	test('keeps the scratch file until every in-flight run finishes', async () => {
		const doc = fakeUntitled('Untitled-1', 'x');
		const first = await manager.write(doc);
		const second = await manager.write(doc);
		assert.strictEqual(first, second);

		await manager.finished(first);
		assert.ok(fs.existsSync(first), 'file was removed while a run was still in flight');

		await manager.finished(second);
		assert.ok(!fs.existsSync(first));
	});

	test('dispose removes any scratch files still on disk', async () => {
		const filePath = await manager.write(fakeUntitled('Untitled-2', 'y'));
		assert.ok(fs.existsSync(filePath));

		manager.dispose();
		// dispose deletes asynchronously; allow the IO to settle.
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.ok(!fs.existsSync(filePath));
	});
});
