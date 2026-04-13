/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from 'typemoq';
import * as path from 'path';
import * as assert from 'assert';
import { SemVer } from 'semver';
import { IInstaller, InstallerResponse } from '../../client/common/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { installPythonInCondaEnv } from '../../client/positron/manager';
import { IApplicationShell } from '../../client/common/application/types';
import { Architecture } from '../../client/common/utils/platform';
import { EnvironmentType } from '../../client/pythonEnvironments/info';

suite('Set up extension', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let installer: TypeMoq.IMock<IInstaller>;
    let shell: TypeMoq.IMock<IApplicationShell>;
    const pythonPath = path.join('path', 'to', 'python', 'interpreter');
    const interpreter = {
        architecture: Architecture.Unknown,
        path: 'python', // Simulates a conda env without Python (predicted path)
        sysPrefix: '',
        sysVersion: '',
        envType: EnvironmentType.Conda,
        envPath: path.join('path', 'to', 'conda', 'env'),
        version: new SemVer('3.11.4'),
    };

    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        interpreterService = TypeMoq.Mock.ofType<IInterpreterService>();
        installer = TypeMoq.Mock.ofType<IInstaller>();
        shell = TypeMoq.Mock.ofType<IApplicationShell>();
        serviceContainer.setup((s) => s.get(IInstaller)).returns(() => installer.object);
        serviceContainer.setup((s) => s.get(IInterpreterService)).returns(() => interpreterService.object);
        serviceContainer.setup((s) => s.get(IApplicationShell)).returns(() => shell.object);
        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter));
        interpreterService
            .setup((i) => i.triggerRefresh())
            .returns(() => Promise.resolve(undefined));
        interpreterService
            .setup((i) => i.refreshPromise)
            .returns(() => Promise.resolve());
        installer
            .setup((i) => i.install(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(InstallerResponse.Installed));
        shell
            .setup((s) => s.withProgress(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((_opts, task) => task());
    });

    test('installPythonInCondaEnv should install Python if necessary', async () => {
        const result = await installPythonInCondaEnv(pythonPath, serviceContainer.object);
        assert.strictEqual(result.installed, true, 'Python should be installed');
    });

    test('installPythonInCondaEnv should not install if interpreter not found', async () => {
        interpreterService.reset();
        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        const result = await installPythonInCondaEnv(pythonPath, serviceContainer.object);
        assert.strictEqual(result.installed, false, 'Python should not be installed');
    });
});
