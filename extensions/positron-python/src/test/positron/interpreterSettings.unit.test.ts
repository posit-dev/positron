/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { WorkspaceConfiguration } from 'vscode';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as externalDependencies from '../../client/pythonEnvironments/common/externalDependencies';
import { getCustomEnvDirs, isPythonStartupDisabled } from '../../client/positron/interpreterSettings';

suite('isPythonStartupDisabled', () => {
    let getConfigurationStub: sinon.SinonStub;
    let startupBehavior: string | undefined;

    setup(() => {
        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        const configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get<string>('startupBehavior')).returns(() => startupBehavior);
        getConfigurationStub.returns(configMock.object);
    });

    teardown(() => {
        sinon.restore();
    });

    test('returns true only when startupBehavior resolves to disabled', () => {
        const cases: [string | undefined, boolean][] = [
            ['disabled', true],
            ['auto', false],
            ['manual', false],
            ['always', false],
            [undefined, false],
        ];
        const results = cases.map(([value]) => {
            startupBehavior = value;
            return isPythonStartupDisabled();
        });
        assert.deepStrictEqual(
            results,
            cases.map(([, expected]) => expected),
        );
    });

    test('reads the python language-scoped interpreters configuration', () => {
        startupBehavior = 'disabled';
        isPythonStartupDisabled();
        assert.deepStrictEqual(getConfigurationStub.firstCall.args, ['interpreters', { languageId: 'python' }]);
    });
});

suite('getCustomEnvDirs', () => {
    const fsRoot = path.parse(process.cwd()).root;
    const missingPath = path.join(fsRoot, 'asdalsk-positron-does-not-exist');
    let override: string[];
    let include: string[];

    setup(() => {
        override = [];
        include = [];

        const configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get<string[]>('interpreters.override')).returns(() => override);
        configMock.setup((c) => c.get<string[]>('interpreters.include')).returns(() => include);
        sinon.stub(workspaceApis, 'getConfiguration').returns(configMock.object);
    });

    teardown(() => {
        sinon.restore();
    });

    test('skips a configured interpreter path that does not exist', () => {
        override = [missingPath];
        assert.deepStrictEqual(getCustomEnvDirs(), []);
    });

    test('skips a nonexistent included path alongside a real directory', () => {
        include = [missingPath, __dirname];
        assert.deepStrictEqual(getCustomEnvDirs(), [__dirname]);
    });

    test('maps an interpreter path to its installation directory', () => {
        // This file stands in for the interpreter binary: <install dir>/positron/<file>.
        override = [__filename];
        assert.deepStrictEqual(getCustomEnvDirs(), [path.dirname(__dirname)]);
    });

    test('never maps an interpreter path up to the filesystem root', () => {
        // A file one level under the root has no installation directory above its
        // parent, and the root must never become a search directory.
        const fileUnderRoot = process.platform === 'win32' ? path.join(fsRoot, 'Windows', 'notepad.exe') : '/etc/hosts';
        if (!fs.existsSync(fileUnderRoot)) {
            // No suitable file on this machine; the mapping rule is covered by the
            // other cases.
            return;
        }
        override = [fileUnderRoot];
        assert.deepStrictEqual(getCustomEnvDirs(), [path.dirname(fileUnderRoot)]);
    });

    test('skips an interpreter that sits directly under the filesystem root', () => {
        // Both the parent and the install directory of such a path are the root
        // itself, so there is nothing to scan short of the whole filesystem.
        const fileAtRoot = path.join(fsRoot, 'python');
        sinon.stub(externalDependencies, 'isDirectorySync').returns(false);
        sinon.stub(externalDependencies, 'pathExistsSync').returns(true);
        override = [fileAtRoot];
        assert.deepStrictEqual(getCustomEnvDirs(), []);
    });
});
