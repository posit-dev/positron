/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../client/common/application/types';
import { IFileSystem } from '../../client/common/platform/types';
import { IProcessServiceFactory } from '../../client/common/process/types';
import { ITerminalServiceFactory } from '../../client/common/terminal/types';
import { IServiceContainer } from '../../client/ioc/types';
import { UvPackageManager } from '../../client/positron/packages/uvPackageManager';
import { PackageSession } from '../../client/positron/packages/types';

/**
 * Interface for emitting messages to the Positron console (matches the one in uvPackageManager.ts)
 */
interface MessageEmitter {
    fire(message: positron.LanguageRuntimeMessage): void;
}

// Test class to expose protected methods
class UvPackageManagerTest extends UvPackageManager {
    public async shouldUseProjectWorkflow(): Promise<boolean> {
        // Access private method via bracket notation for testing
        return (this as any)._shouldUseProjectWorkflow();
    }
}

suite('UvPackageManager Tests', () => {
    let uvPackageManager: UvPackageManagerTest;
    let serviceContainer: IServiceContainer;
    let workspaceService: IWorkspaceService;
    let fileSystem: IFileSystem;
    let messageEmitter: MessageEmitter;
    let session: PackageSession;
    // let uvSandbox: sinon.SinonStub;

    setup(() => {
        // Capture requirements written to the temp file.
        let writtenContent = '';
        fileSystem = {
            fileExists: sinon.stub().resolves(false),
            readFile: sinon.stub().resolves(''),
            createTemporaryFile: sinon.stub().resolves({ filePath: '/tmp/reqs.txt', dispose: sinon.stub() }),
            writeFile: sinon.stub().callsFake((_p: string, text: string) => {
                writtenContent = text;
                return Promise.resolve();
            }),
        } as any;
        (fileSystem as any).getWritten = () => writtenContent;

        workspaceService = {
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
            .withArgs(IWorkspaceService)
            .returns(workspaceService)
            .withArgs(IFileSystem)
            .returns(fileSystem);

        // Create message emitter mock
        messageEmitter = {
            fire: sinon.stub(),
        };

        // Create session mock. getPackages() (used to build the installed set)
        // calls the kernel's 'getPackagesInstalled'; return clean names.
        session = {
            metadata: { sessionId: 'test-session-id' },
            callMethod: sinon
                .stub()
                .resolves([{ name: 'flask' }, { name: 'werkzeug' }, { name: 'positron-update-demo' }]),
        };

        // Create package manager instance
        uvPackageManager = new UvPackageManagerTest('/path/to/python', messageEmitter, serviceContainer, session);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('_shouldUseProjectWorkflow Method', () => {
        test('Should return true when pyproject.toml exists with [project] section and requirements.txt does not', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"
version = "0.1.0"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.true;
        });

        test('Should return false when pyproject.toml exists without [project] section', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[build-system]
requires = ["setuptools"]`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml has [project] section but missing name', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
version = "0.1.0"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml has [project] section but missing version', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml readFile throws error', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .rejects(new Error('Permission denied'));

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when both pyproject.toml and requirements.txt exist', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"
version = "0.1.0"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(true);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml does not exist', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(false);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when no workspace folder is available', async () => {
            sinon.stub(workspaceService, 'workspaceFolders').value(undefined);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });
    });

    suite('Environment-workflow updates', () => {
        let processService: { exec: sinon.SinonStub };
        let terminalService: { show: sinon.SinonStub; sendCommand: sinon.SinonStub; sendText: sinon.SinonStub };
        let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

        setup(() => {
            // Stub getConfiguration so _getProxyEnv() does not crash (vscode.workspace is a mock instance).
            originalGetConfiguration = vscode.workspace.getConfiguration;
            vscode.workspace.getConfiguration = (_section?: string) =>
                ({ get: (_key: string, defaultValue?: unknown) => defaultValue } as any);

            // uv available.
            sinon.stub(uvPackageManager, 'isUvAvailable').resolves(true);

            processService = { exec: sinon.stub() };
            const processFactory = { create: sinon.stub().resolves(processService) };

            terminalService = {
                show: sinon.stub().resolves(),
                sendCommand: sinon.stub().resolves(),
                sendText: sinon.stub().resolves(),
            };
            const terminalFactory = { getTerminalService: sinon.stub().returns(terminalService) };

            (serviceContainer.get as sinon.SinonStub)
                .withArgs(IProcessServiceFactory)
                .returns(processFactory)
                .withArgs(ITerminalServiceFactory)
                .returns(terminalFactory);
        });

        teardown(() => {
            vscode.workspace.getConfiguration = originalGetConfiguration;
        });

        test('updatePackages writes a bare-names requirements file with the target pinned', async () => {
            await uvPackageManager.updatePackages([{ name: 'werkzeug', version: '3.1.8' }]);

            const written = (fileSystem as any).getWritten();
            expect(written).to.contain('werkzeug==3.1.8');
            expect(written).to.contain('flask');
            expect(written).to.not.contain('flask==2.2.0');
            expect(written).to.contain('positron-update-demo'); // installed (local) -> bare name

            const [uvBin, args] = terminalService.sendCommand.firstCall.args;
            expect(uvBin).to.equal('uv');
            expect(args).to.include.members(['pip', 'install', '-r', '/tmp/reqs.txt', '--python', '/path/to/python']);
            expect(args).to.not.include('--upgrade');
        });

        test('updatePackages throws when a target has no version', async () => {
            let caughtError: unknown;
            try {
                await uvPackageManager.updatePackages([{ name: 'werkzeug' }]);
            } catch (e) {
                caughtError = e;
            }
            expect(caughtError).to.be.instanceOf(Error);
            expect((caughtError as Error).message).to.contain('werkzeug');
            expect(terminalService.sendCommand.called).to.equal(false);
        });

        test('updateAllPackages writes a bare file and runs pip install --upgrade -r', async () => {
            processService.exec
                .withArgs('uv', sinon.match.array.startsWith(['pip', 'list', '--outdated']))
                .resolves({ stdout: JSON.stringify([{ name: 'werkzeug', latest_version: '3.1.8' }]), stderr: '' });

            await uvPackageManager.updateAllPackages();

            const written = (fileSystem as any).getWritten();
            expect(written).to.contain('werkzeug');
            expect(written).to.not.contain('werkzeug==');
            const [, args] = terminalService.sendCommand.firstCall.args;
            expect(args).to.include.members([
                'pip',
                'install',
                '--upgrade',
                '-r',
                '/tmp/reqs.txt',
                '--python',
                '/path/to/python',
            ]);
        });

        test('installPackages names the full installed set and adds the new package', async () => {
            await uvPackageManager.installPackages([{ name: 'cowsay', version: '6.1' }]);

            const written = (fileSystem as any).getWritten();
            expect(written).to.contain('cowsay==6.1');
            expect(written).to.contain('flask');
            const [uvBin, args] = terminalService.sendCommand.firstCall.args;
            expect(uvBin).to.equal('uv');
            expect(args).to.include.members(['pip', 'install', '-r', '/tmp/reqs.txt', '--python', '/path/to/python']);
            expect(args).to.not.include('--upgrade');
        });
    });
});
