/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { Uri, WorkspaceConfiguration } from 'vscode';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as logging from '../../client/logging';
import * as externalDependencies from '../../client/pythonEnvironments/common/externalDependencies';
import {
    getCustomEnvDirs,
    getResolvedFilterSettingPaths,
    getUserDefaultInterpreter,
    isPythonStartupDisabled,
    shouldIncludeInterpreter,
} from '../../client/positron/interpreterSettings';
import { InspectInterpreterSettingType } from '../../client/common/types';

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

suite('${workspaceFolder} in interpreter settings', () => {
    const fsRoot = path.parse(process.cwd()).root;
    const folder = Uri.file(path.join(fsRoot, 'work', 'proj')).fsPath;
    const optPython = path.join(fsRoot, 'opt', 'python');
    let include: string[];
    let exclude: string[];
    let override: string[];
    let defaultInterpreterPath: InspectInterpreterSettingType;
    let getWorkspaceFoldersStub: sinon.SinonStub;
    let traceInfoStub: sinon.SinonStub;

    setup(() => {
        include = [];
        exclude = [];
        override = [];
        defaultInterpreterPath = {};

        const configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get<string[]>('interpreters.include')).returns(() => include);
        configMock.setup((c) => c.get<string[]>('interpreters.exclude')).returns(() => exclude);
        configMock.setup((c) => c.get<string[]>('interpreters.override')).returns(() => override);
        configMock
            .setup((c) => c.inspect<string>('defaultInterpreterPath'))
            .returns(() => ({ key: 'python.defaultInterpreterPath', ...defaultInterpreterPath }));
        sinon.stub(workspaceApis, 'getConfiguration').returns(configMock.object);
        getWorkspaceFoldersStub = sinon
            .stub(workspaceApis, 'getWorkspaceFolders')
            .returns([{ uri: Uri.file(folder), name: 'proj', index: 0 }]);
        traceInfoStub = sinon.stub(logging, 'traceInfo');
    });

    teardown(() => {
        sinon.restore();
    });

    test('replaces ${workspaceFolder} in include, exclude, and override', () => {
        include = ['${workspaceFolder}/include'];
        exclude = ['${workspaceFolder}/exclude'];
        override = ['${workspaceFolder}/override'];
        assert.deepStrictEqual(getResolvedFilterSettingPaths(), {
            include: [`${folder}/include`],
            exclude: [`${folder}/exclude`],
            override: [`${folder}/override`],
        });
    });

    test('applies the resolved paths when filtering interpreters', () => {
        exclude = ['${workspaceFolder}/.venv'];
        const excluded = shouldIncludeInterpreter(`${folder}/.venv/bin/python`);
        exclude = [];
        override = ['${workspaceFolder}/.venv'];
        const overridden = [
            shouldIncludeInterpreter(`${folder}/.venv/bin/python`),
            shouldIncludeInterpreter(path.join(fsRoot, 'usr', 'bin', 'python3')),
        ];
        assert.deepStrictEqual({ excluded, overridden }, { excluded: false, overridden: [true, false] });
    });

    test('searches an included ${workspaceFolder} path for interpreters', () => {
        getWorkspaceFoldersStub.returns([{ uri: Uri.file(__dirname), name: 'positron', index: 0 }]);
        include = ['${workspaceFolder}'];
        assert.deepStrictEqual(getCustomEnvDirs(), [__dirname]);
    });

    test('replaces ${workspaceFolder} in each defaultInterpreterPath value', () => {
        defaultInterpreterPath = {
            globalValue: '${workspaceFolder}/global/bin/python',
            workspaceValue: '${workspaceFolder}/workspace/bin/python',
            workspaceFolderValue: '${workspaceFolder}/folder/bin/python',
        };
        const { globalValue, workspaceValue, workspaceFolderValue } = getUserDefaultInterpreter();
        assert.deepStrictEqual(
            { globalValue, workspaceValue, workspaceFolderValue },
            {
                globalValue: `${folder}/global/bin/python`,
                workspaceValue: `${folder}/workspace/bin/python`,
                workspaceFolderValue: `${folder}/folder/bin/python`,
            },
        );
    });

    test('ignores and logs a ${workspaceFolder} path when no folder is open', () => {
        getWorkspaceFoldersStub.returns(undefined);
        include = ['${workspaceFolder}/.venv', optPython];
        defaultInterpreterPath = { workspaceValue: '${workspaceFolder}/.venv/bin/python' };
        assert.deepStrictEqual(
            {
                include: shouldIncludeInterpreter(path.join(optPython, 'bin', 'python')),
                workspaceValue: getUserDefaultInterpreter().workspaceValue,
                logs: traceInfoStub.args.map((args) => args[0]),
            },
            {
                include: true,
                workspaceValue: '',
                logs: [
                    '[shouldIncludeInterpreter]: included interpreter path ${workspaceFolder}/.venv uses ${workspaceFolder}, but no folder is open...ignoring',
                    `[shouldIncludeInterpreter] Interpreter ${path.join(
                        optPython,
                        'bin',
                        'python',
                    )} included via interpreters.include setting`,
                    '[getUserDefaultInterpreter]: interpreter path ${workspaceFolder}/.venv/bin/python uses ${workspaceFolder}, but no folder is open...ignoring',
                ],
            },
        );
    });

    test('ignores and logs an unsupported variable, and keeps the other entries', () => {
        exclude = ['${env:PYTHON_ROOT}/bin/python', '${workspaceFolder}/.venv'];
        assert.deepStrictEqual(
            {
                excluded: shouldIncludeInterpreter(`${folder}/.venv/bin/python`),
                logs: traceInfoStub.args.map((args) => args[0]),
            },
            {
                excluded: false,
                logs: [
                    '[shouldIncludeInterpreter]: excluded interpreter path ${env:PYTHON_ROOT}/bin/python uses unsupported variable ${env:PYTHON_ROOT} (only ${workspaceFolder} is supported)...ignoring',
                    `[shouldIncludeInterpreter] Interpreter ${folder}/.venv/bin/python excluded via interpreters.exclude setting`,
                ],
            },
        );
    });
});
