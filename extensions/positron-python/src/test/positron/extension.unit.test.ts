/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from 'typemoq';
import * as path from 'path';
import * as assert from 'assert';
import { SemVer } from 'semver';
import { IInstaller, InstallerResponse } from '../../client/common/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { checkAndInstallPython } from '../../client/positron/extension';
import { Architecture } from '../../client/common/utils/platform';
import { EnvironmentType } from '../../client/pythonEnvironments/info';

suite('Set up extension', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
    let installer: TypeMoq.IMock<IInstaller>;
    const pythonPath = path.join('path', 'to', 'python', 'interpreter');
    const interpreter = {
        architecture: Architecture.Unknown,
        path: pythonPath,
        sysPrefix: '',
        sysVersion: '',
        envType: EnvironmentType.Conda,
        // arbitrary but supported version
        version: new SemVer('3.11.4'),
    };

    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        interpreterService = TypeMoq.Mock.ofType<IInterpreterService>();
        installer = TypeMoq.Mock.ofType<IInstaller>();
        serviceContainer.setup((s) => s.get(IInstaller)).returns(() => installer.object);
        serviceContainer.setup((s) => s.get(IInterpreterService)).returns(() => interpreterService.object);
        interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(interpreter));
        installer
            .setup((i) => i.install(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(InstallerResponse.Installed));
    });

    test('checkAndInstallPython should install Python if necessary', async () => {
        const result = await checkAndInstallPython(pythonPath, serviceContainer.object);
        assert.strictEqual(result, InstallerResponse.Installed, 'Python install is not resolved');
    });
});
