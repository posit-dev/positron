/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { UnsavedScriptFiles } from '../../../client/terminals/codeExecution/unsavedScripts';

// vscode.workspace is a ts-mockito instance; sinon.stub won't work on it, so we
// reassign the members we use and restore them afterward.
suite('UnsavedScriptFiles', () => {
    let tmpDir: string;
    let manager: UnsavedScriptFiles;
    // Loosely typed so we can install fakes over readonly members (the event).
    const ws = vscode.workspace as any;
    let originalGetConfiguration: unknown;
    let originalOnDidClose: unknown;

    const fakeUntitled = (name: string, text: string) =>
        ({ uri: { toString: () => `untitled:${name}`, path: name }, isUntitled: true, getText: () => text } as any);

    setup(() => {
        // Canonicalize: the manager resolves symlinks (e.g. macOS /var -> /private/var).
        tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'positron-unsaved-test-')));
        originalGetConfiguration = ws.getConfiguration;
        originalOnDidClose = ws.onDidCloseTextDocument;
        ws.getConfiguration = () => ({ get: () => tmpDir });
        ws.onDidCloseTextDocument = () => ({ dispose: () => undefined });
        manager = new UnsavedScriptFiles();
    });

    teardown(() => {
        manager.dispose();
        ws.getConfiguration = originalGetConfiguration;
        ws.onDidCloseTextDocument = originalOnDidClose;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('writes the buffer to a hidden scratch file, then deletes it when the run finishes', async () => {
        const filePath = await manager.write(fakeUntitled('Untitled-1', 'print("hi")'));

        assert.strictEqual(path.dirname(filePath), tmpDir);
        assert.strictEqual(path.basename(filePath), '.positron-untitled-1.py');
        assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'print("hi")');

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
});
