/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toWorkspacePathSpelling } from '../../../client/pythonEnvironments/creation/workspacePathSpelling';

suite('toWorkspacePathSpelling', () => {
    let tempRoot: string;
    let realDir: string;
    let linkDir: string;

    setup(() => {
        tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-spelling-')));
        realDir = path.join(tempRoot, 'real');
        linkDir = path.join(tempRoot, 'link');
        fs.mkdirSync(realDir);
        fs.symlinkSync(realDir, linkDir, 'dir');
    });

    teardown(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    test('Maps paths under the resolved workspace to the workspace spelling', () => {
        assert.deepStrictEqual(
            [
                toWorkspacePathSpelling(path.join(realDir, '.venv', 'bin', 'python'), linkDir),
                toWorkspacePathSpelling(path.join(realDir, '.conda'), linkDir),
                toWorkspacePathSpelling(path.join(tempRoot, 'other', 'python'), linkDir),
                toWorkspacePathSpelling(path.join(realDir, '.venv', 'bin', 'python'), realDir),
                toWorkspacePathSpelling('/some/python', path.join(tempRoot, 'missing')),
            ],
            [
                path.join(linkDir, '.venv', 'bin', 'python'),
                path.join(linkDir, '.conda'),
                path.join(tempRoot, 'other', 'python'),
                path.join(realDir, '.venv', 'bin', 'python'),
                '/some/python',
            ],
        );
    });
});
