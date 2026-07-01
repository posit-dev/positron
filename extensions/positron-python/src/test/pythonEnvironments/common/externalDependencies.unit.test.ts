/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import * as fsapi from '../../../client/common/platform/fs-paths';
import { canonicalizePath, checkParentDirs } from '../../../client/pythonEnvironments/common/externalDependencies';

suite('checkParentDirs tests', () => {
    let pathExistsSyncStub: sinon.SinonStub;

    setup(() => {
        pathExistsSyncStub = sinon.stub(fsapi, 'pathExistsSync');
        pathExistsSyncStub.withArgs('home').returns(true);
        pathExistsSyncStub.withArgs(path.join('home', 'project')).returns(true);
        pathExistsSyncStub.withArgs(path.join('home', 'project', 'file')).returns(false);
        pathExistsSyncStub.withArgs(path.join('home', 'file')).returns(true);
        pathExistsSyncStub.withArgs(path.join('home', 'nonexistent-file')).returns(false);
    });

    teardown(() => {
        pathExistsSyncStub.restore();
    });

    test('checkParentDirs successfully finds the file', () => {
        const root = path.join('home', 'project');
        const filename = 'file';
        const expected = path.join('home', 'file');
        const actual = checkParentDirs(root, filename);
        assert.strictEqual(actual, expected);
    });

    test('checkParentDirs does not find the file', () => {
        const root = path.join('home');
        const filename = 'nonexistent-file';
        const expected = undefined;
        const actual = checkParentDirs(root, filename);
        assert.strictEqual(actual, expected);
    });
});

suite('canonicalizePath tests', () => {
    let realpathStub: sinon.SinonStub;

    setup(() => {
        realpathStub = sinon.stub(fsapi, 'realpath');
    });

    teardown(() => {
        sinon.restore();
    });

    test('returns the fully resolved real path', async () => {
        const input = path.join('home', 'cpython-3.14', 'bin', 'python3.14');
        const resolved = path.join('home', 'cpython-3.14.6', 'bin', 'python3.14');
        realpathStub.withArgs(input).resolves(resolved);

        const actual = await canonicalizePath(input);

        assert.strictEqual(actual, resolved);
    });

    test('falls back to the normalized input path when realpath throws', async () => {
        const input = path.join('home', '..', 'home', 'project', 'bin', 'python');
        realpathStub.withArgs(input).rejects(new Error('ENOENT'));

        const actual = await canonicalizePath(input);

        assert.strictEqual(actual, path.normalize(input));
    });
});
