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
import { IWorkspaceService } from '../../../client/common/application/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import * as uvUtils from '../../../client/pythonEnvironments/common/environmentManagers/uv';

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
    let interpreterService: IInterpreterService;
    let workspaceService: IWorkspaceService;
    let isUvInstalledStub: sinon.SinonStub;

    setup(() => {
        // Create mocks for services
        configurationService = {
            getSettings: sinon.stub(),
        } as any;

        interpreterService = {
            getActiveInterpreter: sinon.stub(),
        } as any;

        workspaceService = {
            getConfiguration: sinon.stub().returns({
                get: sinon.stub().returns(''),
            }),
        } as any;

        // Create service container mock
        serviceContainer = {
            get: sinon.stub(),
        } as any;

        // Configure service container to return the appropriate services
        (serviceContainer.get as sinon.SinonStub)
            .withArgs(IConfigurationService)
            .returns(configurationService)
            .withArgs(IInterpreterService)
            .returns(interpreterService)
            .withArgs(IWorkspaceService)
            .returns(workspaceService);

        // Create stubs for external dependencies
        isUvInstalledStub = sinon.stub(uvUtils, 'isUvInstalled');

        // Create installer instance
        uvInstaller = new UVInstallerTest(serviceContainer);
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

            const interpreter = {
                path: pythonPath,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
            expect((configurationService.getSettings as sinon.SinonStub).calledWith(resource)).to.be.true;
            expect((interpreterService.getActiveInterpreter as sinon.SinonStub).calledWith(resource)).to.be.true;
        });

        test('Should return correct execution info for PythonEnvironment', async () => {
            const pythonEnv: PythonEnvironment = {
                path: '/path/to/python',
                envPath: '/path/to/env',
            } as PythonEnvironment;
            const moduleName = 'pandas';

            const result = await uvInstaller.getExecutionInfo(moduleName, pythonEnv);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonEnv.path, moduleName],
                execPath: 'uv',
            });
        });

        test('Should handle empty python path from interpreter', async () => {
            const resource = Uri.file('/test/path');
            const moduleName = 'requests';

            const settings: IPythonSettings = {
                pythonPath: '/fallback/python',
            } as IPythonSettings;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(null);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', '/fallback/python', moduleName],
                execPath: 'uv',
            });
        });

        test('Should handle undefined interpreter result', async () => {
            const resource = Uri.file('/test/path');
            const moduleName = 'matplotlib';

            const settings: IPythonSettings = {
                pythonPath: '/settings/python',
            } as IPythonSettings;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(undefined);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', '/settings/python', moduleName],
                execPath: 'uv',
            });
        });

        test('Should handle empty settings python path', async () => {
            const resource = Uri.file('/test/path');
            const moduleName = 'scipy';

            const settings: IPythonSettings = {
                pythonPath: '',
            } as IPythonSettings;

            const interpreter = {
                path: '/interpreter/python',
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', '/interpreter/python', moduleName],
                execPath: 'uv',
            });
        });

        test('Should work without resource parameter', async () => {
            const moduleName = 'pytest';

            const settings: IPythonSettings = {
                pythonPath: '/default/python',
            } as IPythonSettings;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);

            const result = await uvInstaller.getExecutionInfo(moduleName);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', '/default/python', moduleName],
                execPath: 'uv',
            });
            expect((configurationService.getSettings as sinon.SinonStub).calledWith(undefined)).to.be.true;
        });

        test('Should handle module names with special characters', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'package-with-dashes>=1.0.0';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should include proxy configuration when set', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'numpy';
            const proxyUrl = 'http://proxy.example.com:8080';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);

            // Mock workspace service to return proxy configuration
            (workspaceService.getConfiguration as sinon.SinonStub).returns({
                get: sinon.stub().withArgs('proxy', '').returns(proxyUrl),
            });

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, '--proxy', proxyUrl, moduleName],
                execPath: 'uv',
            });
        });
    });
});
