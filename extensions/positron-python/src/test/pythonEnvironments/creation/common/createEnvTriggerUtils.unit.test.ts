/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as typemoq from 'typemoq';
import { Uri, WorkspaceFolder } from 'vscode';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../../../client/pythonEnvironments/info';
import { isGlobalPythonSelected } from '../../../../client/pythonEnvironments/creation/common/createEnvTriggerUtils';

suite('Create Environment Trigger - isGlobalPythonSelected', () => {
    const workspace: WorkspaceFolder = { uri: Uri.file('/project'), name: 'project', index: 0 };
    let interpreterService: typemoq.IMock<IInterpreterService>;

    setup(() => {
        interpreterService = typemoq.Mock.ofType<IInterpreterService>();
    });

    function withActiveInterpreter(interpreter: PythonEnvironment | undefined) {
        interpreterService
            .setup((s) => s.getActiveInterpreter(typemoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter));
    }

    function env(envPath: string, envType: EnvironmentType): PythonEnvironment {
        return { path: envPath, envType, sysPrefix: '' } as PythonEnvironment;
    }

    const cases: [string, PythonEnvironment | undefined, boolean][] = [
        ['unresolved interpreter', undefined, true],
        ['system python', env('/usr/bin/python3', EnvironmentType.System), true],
        ['pyenv version', env('/home/u/.pyenv/versions/3.12.3/bin/python', EnvironmentType.Pyenv), true],
        ['~/.local install', env(path.join(os.homedir(), '.local', 'bin', 'python'), EnvironmentType.Venv), true],
        ['venv', env('/project/.venv/bin/python', EnvironmentType.Venv), false],
        ['conda env', env('/opt/conda/envs/x/bin/python', EnvironmentType.Conda), false],
        ['uv env', env('/project/.venv/bin/python', EnvironmentType.Uv), false],
    ];

    for (const [label, interpreter, expected] of cases) {
        test(`${label} is ${expected ? 'global' : 'not global'}`, async () => {
            withActiveInterpreter(interpreter);
            assert.strictEqual(await isGlobalPythonSelected(workspace, interpreterService.object), expected);
        });
    }

    test('reads the active interpreter for the workspace folder', async () => {
        withActiveInterpreter(undefined);
        await isGlobalPythonSelected(workspace, interpreterService.object);
        interpreterService.verify((s) => s.getActiveInterpreter(workspace.uri), typemoq.Times.once());
    });
});
