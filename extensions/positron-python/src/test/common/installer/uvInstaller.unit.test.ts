/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { UVInstaller } from '../../../client/common/installer/uvInstaller';
import { ExecutionInfo, IConfigurationService, IPythonSettings } from '../../../client/common/types';
import { IServiceContainer } from '../../../client/ioc/types';
import { ModuleInstallerType, PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { InterpreterUri } from '../../../client/common/installer/types';
import * as uvUtils from '../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as envUtils from '../../../client/pythonEnvironments/base/info/env';

// Test class to expose protected methods
class UVInstallerTest extends UVInstaller {
    public async getExecutionInfo(moduleName: string, resource?: InterpreterUri): Promise<ExecutionInfo> {
        return super.getExecutionInfo(moduleName, resource);
    }
}

suite('UV Installer Tests', () => {
    let uvInstaller: UVInstallerTest;
    let serviceContainer: IServiceContainer;
    let configurationService: IConfigurationService;
    let isUvInstalledStub: sinon.SinonStub;
    let getEnvPathStub: sinon.SinonStub;

    setup(() => {
        // Create mocks
        serviceContainer = {} as IServiceContainer;
        configurationService = {
            getSettings: sinon.stub(),
        } as any;

        // Create stubs for external dependencies
        isUvInstalledStub = sinon.stub(uvUtils, 'isUvInstalled');
        getEnvPathStub = sinon.stub(envUtils, 'getEnvPath');

        // Create installer instance
        uvInstaller = new UVInstallerTest(serviceContainer, configurationService);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Basic Properties', () => {
        test('Should have correct name', () => {
            expect(uvInstaller.name).to.equal('Uv');
        });

        test('Should have correct display name', () => {
            expect(uvInstaller.displayName).to.equal('uv');
        });

        test('Should have correct type', () => {
            expect(uvInstaller.type).to.equal(ModuleInstallerType.Uv);
        });

        test('Should have correct priority', () => {
            expect(uvInstaller.priority).to.equal(30);
        });
    });

    suite('isSupported Method', () => {
        test('Should return true when uv is installed', async () => {
            isUvInstalledStub.resolves(true);

            const result = await uvInstaller.isSupported();

            expect(result).to.be.true;
            expect(isUvInstalledStub.calledOnce).to.be.true;
        });

        test('Should return false when uv is not installed', async () => {
            isUvInstalledStub.resolves(false);

            const result = await uvInstaller.isSupported();

            expect(result).to.be.false;
            expect(isUvInstalledStub.calledOnce).to.be.true;
        });

        test('Should return false when uv check throws error', async () => {
            isUvInstalledStub.rejects(new Error('Command not found'));

            const result = await uvInstaller.isSupported();

            expect(result).to.be.false;
            expect(isUvInstalledStub.calledOnce).to.be.true;
        });

        test('Should work with resource parameter', async () => {
            const resource = Uri.file('/test/path');
            isUvInstalledStub.resolves(true);

            const result = await uvInstaller.isSupported(resource);

            expect(result).to.be.true;
            expect(isUvInstalledStub.calledOnce).to.be.true;
        });

        test('Should work with PythonEnvironment parameter', async () => {
            const pythonEnv: PythonEnvironment = {
                path: '/path/to/python',
                envPath: '/path/to/env',
            } as PythonEnvironment;
            isUvInstalledStub.resolves(true);

            const result = await uvInstaller.isSupported(pythonEnv);

            expect(result).to.be.true;
            expect(isUvInstalledStub.calledOnce).to.be.true;
        });
    });

    suite('getExecutionInfo Method', () => {
        test('Should return correct execution info for resource', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'numpy';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
            expect((configurationService.getSettings as sinon.SinonStub).calledWith(resource)).to.be.true;
        });

        test('Should return correct execution info for PythonEnvironment', async () => {
            const pythonEnv: PythonEnvironment = {
                path: '/path/to/python',
                envPath: '/path/to/env',
            } as PythonEnvironment;
            const moduleName = 'pandas';
            const expectedPythonPath = '/resolved/path/to/python';

            getEnvPathStub.returns({ path: expectedPythonPath });

            const result = await uvInstaller.getExecutionInfo(moduleName, pythonEnv);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--python', expectedPythonPath, moduleName],
                execPath: 'uv',
            });
            expect(getEnvPathStub.calledWith(pythonEnv.path, pythonEnv.envPath)).to.be.true;
        });

        test('Should handle empty python path from getEnvPath', async () => {
            const pythonEnv: PythonEnvironment = {
                path: '/path/to/python',
                envPath: '/path/to/env',
            } as PythonEnvironment;
            const moduleName = 'requests';

            getEnvPathStub.returns({ path: null });

            const result = await uvInstaller.getExecutionInfo(moduleName, pythonEnv);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--python', '', moduleName],
                execPath: 'uv',
            });
        });

        test('Should handle undefined getEnvPath result', async () => {
            const pythonEnv: PythonEnvironment = {
                path: '/path/to/python',
                envPath: '/path/to/env',
            } as PythonEnvironment;
            const moduleName = 'matplotlib';

            getEnvPathStub.returns({});

            const result = await uvInstaller.getExecutionInfo(moduleName, pythonEnv);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--python', '', moduleName],
                execPath: 'uv',
            });
        });

        test('Should handle empty settings python path', async () => {
            const resource = Uri.file('/test/path');
            const moduleName = 'scipy';

            const settings: IPythonSettings = {
                pythonPath: '',
            } as IPythonSettings;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--python', '', moduleName],
                execPath: 'uv',
            });
        });

        test('Should work without resource parameter', async () => {
            const moduleName = 'pytest';

            // When no resource is provided, isResource returns true and calls getSettings with undefined
            const settings: IPythonSettings = {
                pythonPath: '',
            } as IPythonSettings;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);

            const result = await uvInstaller.getExecutionInfo(moduleName);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--python', '', moduleName],
                execPath: 'uv',
            });
        });

        test('Should handle module names with special characters', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'package-with-dashes>=1.0.0';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });
    });
});
