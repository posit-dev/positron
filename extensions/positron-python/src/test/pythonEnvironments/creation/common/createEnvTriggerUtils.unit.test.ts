/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import * as fs from '../../../../client/common/platform/fs-paths';
import { hasUvLock, hasPixiLock } from '../../../../client/pythonEnvironments/creation/common/createEnvTriggerUtils';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../constants';

suite('CreateEnvTriggerUtils', () => {
    let pathExistsStub: sinon.SinonStub;
    const workspace1 = {
        uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
        name: 'workspace1',
        index: 0,
    };

    setup(() => {
        pathExistsStub = sinon.stub(fs, 'pathExists');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('hasUvLock', () => {
        test('uv.lock exists at workspace root', async () => {
            pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'uv.lock')).resolves(true);
            expect(await hasUvLock(workspace1)).to.be.equal(true);
        });

        test('uv.lock does not exist at workspace root', async () => {
            pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'uv.lock')).resolves(false);
            expect(await hasUvLock(workspace1)).to.be.equal(false);
        });
    });

    suite('hasPixiLock', () => {
        test('pixi.lock exists at workspace root', async () => {
            pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'pixi.lock')).resolves(true);
            expect(await hasPixiLock(workspace1)).to.be.equal(true);
        });

        test('pixi.lock does not exist at workspace root', async () => {
            pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'pixi.lock')).resolves(false);
            expect(await hasPixiLock(workspace1)).to.be.equal(false);
        });
    });
});
