// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// --- Start Positron ---
// Disable eslint rules for our import block below. This appears at the top of the file to stop
// auto-formatting tools from reordering the imports.
/* eslint-disable import/no-duplicates */
/* eslint-disable import/order */
// --- End Positron ---

'use strict';

import { expect } from 'chai';
import * as TypeMoq from 'typemoq';
import { IApplicationShell } from '../../../client/common/application/types';
import { DataScienceInstaller } from '../../../client/common/installer/productInstaller';
import { IInstallationChannelManager, IModuleInstaller, InterpreterUri } from '../../../client/common/installer/types';
// --- Start Positron ---
import { ModuleInstallFlags } from '../../../client/common/installer/types';
// --- End Positron ---
import { InstallerResponse, Product } from '../../../client/common/types';
import { Architecture } from '../../../client/common/utils/platform';
import { IServiceContainer } from '../../../client/ioc/types';
import { EnvironmentType, ModuleInstallerType, PythonEnvironment } from '../../../client/pythonEnvironments/info';

class AlwaysInstalledDataScienceInstaller extends DataScienceInstaller {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, class-methods-use-this
    public async isInstalled(_product: Product, _resource?: InterpreterUri): Promise<boolean> {
        return true;
    }
}

suite('DataScienceInstaller install', async () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let installationChannelManager: TypeMoq.IMock<IInstallationChannelManager>;
    let dataScienceInstaller: DataScienceInstaller;
    let appShell: TypeMoq.IMock<IApplicationShell>;

    const interpreterPath = 'path/to/interpreter';

    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        installationChannelManager = TypeMoq.Mock.ofType<IInstallationChannelManager>();
        appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        appShell.setup((a) => a.showErrorMessage(TypeMoq.It.isAnyString())).returns(() => Promise.resolve(undefined));
        serviceContainer
            .setup((c) => c.get(TypeMoq.It.isValue(IInstallationChannelManager)))
            .returns(() => installationChannelManager.object);

        serviceContainer.setup((c) => c.get(TypeMoq.It.isValue(IApplicationShell))).returns(() => appShell.object);

        dataScienceInstaller = new AlwaysInstalledDataScienceInstaller(serviceContainer.object);
    });

    teardown(() => {
        // noop
    });

    test('Will invoke conda for conda environments', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            envName: 'test',
            envPath: interpreterPath,
            path: interpreterPath,
            architecture: Architecture.x64,
            sysPrefix: '',
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();
        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Conda);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    // --- Start Positron ---
                    // We added the `options` param in https://github.com/posit-dev/positron-python/pull/66.
                    TypeMoq.It.isAny(),
                    // --- End Positron ---
                ),
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([testInstaller.object]));

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    test('Will invoke pip by default', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.VirtualEnv,
            envName: 'test',
            envPath: interpreterPath,
            path: interpreterPath,
            architecture: Architecture.x64,
            sysPrefix: '',
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Pip);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    // --- Start Positron ---
                    // We added the `options` param in https://github.com/posit-dev/positron-python/pull/66.
                    TypeMoq.It.isAny(),
                    // --- End Positron ---
                ),
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([testInstaller.object]));

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    test('Will invoke pip for pytorch with conda environment', async () => {
        // See https://github.com/microsoft/vscode-jupyter/issues/5034
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.Conda,
            envName: 'test',
            envPath: interpreterPath,
            path: interpreterPath,
            architecture: Architecture.x64,
            sysPrefix: '',
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Pip);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.torchProfilerInstallName),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    // --- Start Positron ---
                    // We added the `options` param in https://github.com/posit-dev/positron-python/pull/66.
                    TypeMoq.It.isAny(),
                    // --- End Positron ---
                ),
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([testInstaller.object]));

        const result = await dataScienceInstaller.install(Product.torchProfilerInstallName, testEnvironment);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    test('Will invoke poetry', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.Poetry,
            envName: 'test',
            envPath: interpreterPath,
            path: interpreterPath,
            architecture: Architecture.x64,
            sysPrefix: '',
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Poetry);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    // --- Start Positron ---
                    // We added the `options` param in https://github.com/posit-dev/positron-python/pull/66.
                    TypeMoq.It.isAny(),
                    // --- End Positron ---
                ),
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([testInstaller.object]));

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    test('Will invoke pipenv', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.Pipenv,
            envName: 'test',
            envPath: interpreterPath,
            path: interpreterPath,
            architecture: Architecture.x64,
            sysPrefix: '',
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Pipenv);
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    // --- Start Positron ---
                    // We added the `options` param in https://github.com/posit-dev/positron-python/pull/66.
                    TypeMoq.It.isAny(),
                    // --- End Positron ---
                ),
            )
            .returns(() => Promise.resolve());

        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([testInstaller.object]));

        const result = await dataScienceInstaller.install(Product.ipykernel, testEnvironment);
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });

    // --- Start Positron ---
    test('Will install pip if necessary', async () => {
        const testEnvironment: PythonEnvironment = {
            envType: EnvironmentType.VirtualEnv,
            envName: 'test',
            envPath: interpreterPath,
            path: interpreterPath,
            architecture: Architecture.x64,
            sysPrefix: '',
        };
        const testInstaller = TypeMoq.Mock.ofType<IModuleInstaller>();

        testInstaller.setup((c) => c.type).returns(() => ModuleInstallerType.Pip);

        // Mock a function to install Product.pip
        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.pip),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    // We added the `options` param in https://github.com/posit-dev/positron-python/pull/66.
                    TypeMoq.It.isAny(),
                ),
            )
            .callback(() => {
                // Add the testInstaller to the available channels once installModule is called
                // with Product.pip
                installationChannelManager
                    .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
                    .returns(() => Promise.resolve([testInstaller.object]));
            })
            .returns(() => Promise.resolve());

        testInstaller
            .setup((c) =>
                c.installModule(
                    TypeMoq.It.isValue(Product.ipykernel),
                    TypeMoq.It.isValue(testEnvironment),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    // We added the `options` param in https://github.com/posit-dev/positron-python/pull/66.
                    TypeMoq.It.isAny(),
                ),
            )
            .returns(() => Promise.resolve());

        serviceContainer
            .setup((c) => c.getAll(TypeMoq.It.isValue(IModuleInstaller)))
            .returns(() => [testInstaller.object]);

        installationChannelManager
            .setup((c) => c.getInstallationChannels(TypeMoq.It.isAny()))
            // Specify no installation channels from the get-go
            .returns(() => Promise.resolve([]));

        const result = await dataScienceInstaller.install(
            Product.ipykernel,
            testEnvironment,
            undefined,
            // Pass in the flag to install Pip if it's not available yet
            ModuleInstallFlags.installPipIfRequired,
        );
        expect(result).to.equal(InstallerResponse.Installed, 'Should be Installed');
    });
    // --- End Positron ---
});
