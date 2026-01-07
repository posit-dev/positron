/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { UVInstaller } from '../../../client/common/installer/uvInstaller';
import { ExecutionInfo, IConfigurationService, IPythonSettings } from '../../../client/common/types';
import { IServiceContainer } from '../../../client/ioc/types';
import { ModuleInstallerType, PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { InterpreterUri } from '../../../client/common/installer/types';
import { IWorkspaceService } from '../../../client/common/application/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { IFileSystem } from '../../../client/common/platform/types';
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
    let fileSystem: IFileSystem;
    let isUvInstalledStub: sinon.SinonStub;

    setup(() => {
        // Create mocks for services
        configurationService = {
            getSettings: sinon.stub(),
        } as any;

        interpreterService = {
            getActiveInterpreter: sinon.stub(),
        } as any;

        fileSystem = {
            fileExists: sinon.stub().resolves(false),
            readFile: sinon.stub().resolves(''),
        } as any;

        workspaceService = {
            getConfiguration: sinon.stub().returns({
                get: sinon.stub().returns(''),
            }),
            getWorkspaceFolder: sinon.stub().returns(undefined),
            get workspaceFolders() {
                return undefined;
            },
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
            .returns(workspaceService)
            .withArgs(IFileSystem)
            .returns(fileSystem);

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
    });

    suite('uv add workflow tests', () => {
        test('Should use "uv add" when pyproject.toml exists with [project] section and requirements.txt does not', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'numpy';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"
version = "0.1.0"`;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(workspaceFolder);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['add', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should use "uv pip install" when pyproject.toml exists without [project] section', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'numpy';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[build-system]
requires = ["setuptools"]`;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(workspaceFolder);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should use "uv pip install" when pyproject.toml readFile throws error', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'numpy';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(workspaceFolder);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .rejects(new Error('Permission denied'));

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should use "uv pip install" when both pyproject.toml and requirements.txt exist', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'pandas';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(workspaceFolder);
            (fileSystem.fileExists as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(true)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt'))
                .resolves(true);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should use "uv pip install" when pyproject.toml does not exist', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'requests';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(workspaceFolder);
            (fileSystem.fileExists as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(false)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt'))
                .resolves(false);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should use "uv pip install" for ipykernel even with pyproject.toml', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'ipykernel';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(workspaceFolder);
            (fileSystem.fileExists as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(true)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt'))
                .resolves(false);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should use "uv add" with first workspace folder when no resource workspace found', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'scipy';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"`;

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(undefined);
            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            (fileSystem.fileExists as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(true)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt'))
                .resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['add', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });

        test('Should use "uv pip install" when no workspace folder is available', async () => {
            const resource = Uri.file('/test/path');
            const pythonPath = '/path/to/python';
            const moduleName = 'matplotlib';

            const settings: IPythonSettings = {
                pythonPath,
            } as IPythonSettings;

            const interpreter = {
                path: pythonPath,
            };

            (configurationService.getSettings as sinon.SinonStub).returns(settings);
            (interpreterService.getActiveInterpreter as sinon.SinonStub).resolves(interpreter);
            (workspaceService.getWorkspaceFolder as sinon.SinonStub).returns(undefined);
            sinon.stub(workspaceService, 'workspaceFolders').value(undefined);

            const result = await uvInstaller.getExecutionInfo(moduleName, resource);

            expect(result).to.deep.equal({
                args: ['pip', 'install', '--upgrade', '--python', pythonPath, moduleName],
                execPath: 'uv',
            });
        });
    });
});
