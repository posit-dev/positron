/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as path from 'path';
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { Uri } from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { IPythonExecutionFactory } from '../../client/common/process/types';
import { ITerminalServiceFactory } from '../../client/common/terminal/types';
import { IFileSystem } from '../../client/common/platform/types';
import { IWorkspaceService } from '../../client/common/application/types';
import { IServiceContainer } from '../../client/ioc/types';
import { PipPackageManager } from '../../client/positron/packages/pipPackageManager';
import { PackageSession } from '../../client/positron/packages/types';

interface MessageEmitter {
    fire(message: positron.LanguageRuntimeMessage): void;
}

suite('PipPackageManager update Tests', () => {
    let manager: PipPackageManager;
    let serviceContainer: IServiceContainer;
    let pythonService: { isModuleInstalled: sinon.SinonStub; execModule: sinon.SinonStub };
    let terminalService: { show: sinon.SinonStub; sendCommand: sinon.SinonStub; sendText: sinon.SinonStub };
    let fileSystem: {
        createTemporaryFile: sinon.SinonStub;
        writeFile: sinon.SinonStub;
        fileExists: sinon.SinonStub;
        readFile: sinon.SinonStub;
    };
    let workspaceService: IWorkspaceService;
    let writtenContent: string;
    let messageEmitter: MessageEmitter;
    let session: PackageSession;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

    setup(() => {
        pythonService = {
            isModuleInstalled: sinon.stub().resolves(true),
            execModule: sinon.stub(),
        };
        // Default freeze output; individual tests can override.
        pythonService.execModule.withArgs('pip', sinon.match.array.startsWith(['freeze'])).resolves({
            stdout: 'flask==2.2.0\nwerkzeug==2.0.3\npositron-update-demo @ file:///tmp/demo\n',
            stderr: '',
        });

        terminalService = {
            show: sinon.stub().resolves(),
            sendCommand: sinon.stub().resolves(),
            sendText: sinon.stub().resolves(),
        };

        writtenContent = '';
        fileSystem = {
            fileExists: sinon.stub().resolves(false),
            createTemporaryFile: sinon.stub().resolves({ filePath: '/tmp/reqs.txt', dispose: sinon.stub() }),
            writeFile: sinon.stub().callsFake((_p: string, text: string) => {
                writtenContent = text;
                return Promise.resolve();
            }),
            readFile: sinon.stub().resolves(''),
        };
        workspaceService = {
            get workspaceFolders() {
                return undefined;
            },
        } as any;

        // Assign getConfiguration so _getProxyFlags() gets a real WorkspaceConfiguration-like
        // object (vscode.workspace is a ts-mockito instance; sinon.stub won't work on it).
        originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = (_section?: string) =>
            ({ get: (_key: string, defaultValue?: unknown) => defaultValue } as any);

        serviceContainer = { get: sinon.stub() } as any;
        const pythonFactory: IPythonExecutionFactory = { create: sinon.stub().resolves(pythonService) } as any;
        const terminalFactory: ITerminalServiceFactory = {
            getTerminalService: sinon.stub().returns(terminalService),
        } as any;
        (serviceContainer.get as sinon.SinonStub)
            .withArgs(IPythonExecutionFactory)
            .returns(pythonFactory)
            .withArgs(ITerminalServiceFactory)
            .returns(terminalFactory)
            .withArgs(IFileSystem)
            .returns(fileSystem)
            .withArgs(IWorkspaceService)
            .returns(workspaceService);

        messageEmitter = { fire: sinon.stub() };
        session = { metadata: { sessionId: 'test' }, callMethod: sinon.stub().resolves([]) };
        manager = new PipPackageManager('/path/to/python', messageEmitter, serviceContainer, session);
    });

    teardown(() => {
        sinon.restore();
        vscode.workspace.getConfiguration = originalGetConfiguration;
    });

    test('updatePackages writes a bare-names requirements file with the target pinned', async () => {
        await manager.updatePackages([{ name: 'werkzeug', version: '3.1.8' }]);

        expect(writtenContent).to.contain('werkzeug==3.1.8'); // target pinned
        expect(writtenContent).to.contain('flask'); // other PyPI -> bare
        expect(writtenContent).to.not.contain('flask==2.2.0'); // not pinned
        expect(writtenContent).to.contain('positron-update-demo @ file:///tmp/demo'); // origin verbatim

        const [pythonPath, args] = terminalService.sendCommand.firstCall.args;
        expect(pythonPath).to.equal('/path/to/python');
        expect(args).to.include.members(['-m', 'pip', 'install', '-r', '/tmp/reqs.txt']);
        expect(args).to.not.include('--upgrade');
    });

    test('updatePackages throws when a target has no version', async () => {
        let caughtError: unknown;
        try {
            await manager.updatePackages([{ name: 'werkzeug' }]);
        } catch (e) {
            caughtError = e;
        }
        expect(caughtError).to.be.instanceOf(Error);
        expect((caughtError as Error).message).to.contain('werkzeug');
        expect(terminalService.sendCommand.called).to.equal(false);
    });

    test('updatePackages propagates a resolver failure (no silent success)', async () => {
        terminalService.sendCommand.rejects(new Error('Command failed with errors'));

        let threw = false;
        try {
            await manager.updatePackages([{ name: 'werkzeug', version: '3.1.8' }]);
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
    });

    test('updateAllPackages writes a bare requirements file and runs install --upgrade -r', async () => {
        pythonService.execModule
            .withArgs('pip', sinon.match.array.startsWith(['list', '--outdated']))
            .resolves({ stdout: JSON.stringify([{ name: 'werkzeug', latest_version: '3.1.8' }]), stderr: '' });

        await manager.updateAllPackages();

        expect(writtenContent).to.contain('werkzeug'); // bare, no pin
        expect(writtenContent).to.not.contain('werkzeug==');
        expect(writtenContent).to.contain('positron-update-demo @ file:///tmp/demo');
        const [, args] = terminalService.sendCommand.firstCall.args;
        expect(args).to.include.members(['install', '--upgrade', '-r', '/tmp/reqs.txt']);
    });

    test('updateAllPackages does nothing when no packages are outdated', async () => {
        pythonService.execModule
            .withArgs('pip', sinon.match.array.startsWith(['list', '--outdated']))
            .resolves({ stdout: '[]', stderr: '' });

        await manager.updateAllPackages();

        expect(terminalService.sendCommand.called).to.equal(false);
    });

    test('installPackages names the full installed set and adds the new package', async () => {
        await manager.installPackages([{ name: 'cowsay', version: '6.1' }]);

        expect(writtenContent).to.contain('cowsay==6.1'); // new package pinned
        expect(writtenContent).to.contain('flask'); // installed -> bare
        expect(writtenContent).to.contain('positron-update-demo @ file:///tmp/demo'); // origin verbatim
        const [, args] = terminalService.sendCommand.firstCall.args;
        expect(args).to.include.members(['install', '-r', '/tmp/reqs.txt']);
        expect(args).to.not.include('--upgrade');
    });

    test('installPackages adds a versionless new package as a bare name', async () => {
        await manager.installPackages([{ name: 'cowsay' }]);
        expect(writtenContent).to.contain('cowsay');
        expect(writtenContent).to.not.contain('cowsay==');
    });

    test('installPackages proceeds on an empty environment (freeze returns nothing)', async () => {
        // A fresh env (e.g. newly created via pyenv) has no user packages, so
        // `pip freeze` prints nothing. The install must still proceed with only
        // the target, not fail with "returned no output".
        pythonService.execModule
            .withArgs('pip', sinon.match.array.startsWith(['freeze']))
            .resolves({ stdout: '', stderr: '' });

        await manager.installPackages([{ name: 'cowsay', version: '6.1' }]);

        expect(writtenContent).to.equal('cowsay==6.1\n');
        const [, args] = terminalService.sendCommand.firstCall.args;
        expect(args).to.include.members(['install', '-r', '/tmp/reqs.txt']);
    });

    test('installPackages propagates a resolver failure (no silent success)', async () => {
        terminalService.sendCommand.rejects(new Error('Command failed with errors'));

        let threw = false;
        try {
            await manager.installPackages([{ name: 'cowsay', version: '6.1' }]);
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
    });

    suite('with workspace requirements.txt', () => {
        let reqPath: string;

        setup(() => {
            const workspaceFolder = { uri: Uri.file('/workspace'), name: 'ws', index: 0 };
            reqPath = path.join(workspaceFolder.uri.fsPath, 'requirements.txt');
            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            fileSystem.fileExists.withArgs(reqPath).resolves(true);
        });

        test('installPackages passes the target on the command line plus -r requirements.txt', async () => {
            await manager.installPackages([{ name: 'cowsay', version: '6.1' }]);

            const [, args] = terminalService.sendCommand.firstCall.args;
            expect(args).to.include.members(['install', 'cowsay==6.1', '-r', reqPath]);
            expect(args).to.not.include('--upgrade');
            // No freeze temp file synthesized.
            expect(fileSystem.createTemporaryFile.called).to.equal(false);
            expect(pythonService.execModule.calledWithMatch('pip', sinon.match.array.startsWith(['freeze']))).to.equal(
                false,
            );
        });

        test('installPackages passes a versionless target as a bare name', async () => {
            await manager.installPackages([{ name: 'cowsay' }]);

            const [, args] = terminalService.sendCommand.firstCall.args;
            expect(args).to.include.members(['install', 'cowsay', '-r', reqPath]);
        });

        test('updatePackages pins the target on the command line plus -r requirements.txt (no --upgrade)', async () => {
            await manager.updatePackages([{ name: 'werkzeug', version: '3.1.8' }]);

            const [, args] = terminalService.sendCommand.firstCall.args;
            expect(args).to.include.members(['install', 'werkzeug==3.1.8', '-r', reqPath]);
            expect(args).to.not.include('--upgrade');
        });

        test('updateAllPackages runs install --upgrade -r requirements.txt with no targets', async () => {
            pythonService.execModule
                .withArgs('pip', sinon.match.array.startsWith(['list', '--outdated']))
                .resolves({ stdout: JSON.stringify([{ name: 'werkzeug', latest_version: '3.1.8' }]), stderr: '' });

            await manager.updateAllPackages();

            const [, args] = terminalService.sendCommand.firstCall.args;
            expect(args).to.include.members(['install', '--upgrade', '-r', reqPath]);
            expect(fileSystem.createTemporaryFile.called).to.equal(false);
        });
    });

    suite('PipPackageManager requirements sync', () => {
        let reqPath: string;
        let callMethod: sinon.SinonStub;

        setup(() => {
            const workspaceFolder = { uri: Uri.file('/w'), name: 'w', index: 0 };
            reqPath = path.join(workspaceFolder.uri.fsPath, 'requirements.txt');
            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            fileSystem.fileExists.withArgs(reqPath).resolves(true);
            fileSystem.readFile.resolves('flask==2.2.0\n');

            callMethod = sinon.stub().resolves([]);
            callMethod.withArgs('getPackagesInstalled').resolves([{ name: 'flask' }, { name: 'pandas' }]);
            session.callMethod = callMethod;

            vscode.workspace.getConfiguration = (section?: string) =>
                ({
                    get: (key: string, defaultValue?: unknown) =>
                        section === 'packages.python' && key === 'autoUpdateRequirements' ? true : defaultValue,
                } as unknown as vscode.WorkspaceConfiguration);
        });

        test('install appends a newly installed undeclared package', async () => {
            await manager.installPackages([{ name: 'pandas' }]);
            expect(writtenContent).to.equal('flask==2.2.0\npandas\n');
        });

        test('uninstall removes a declared package once it is gone', async () => {
            fileSystem.readFile.resolves('flask==2.2.0\nrequests\n');
            callMethod.withArgs('getPackagesInstalled').resolves([{ name: 'flask' }]);

            await manager.uninstallPackages(['requests']);
            expect(writtenContent).to.equal('flask==2.2.0\n');
        });

        test('does nothing when the setting is disabled', async () => {
            vscode.workspace.getConfiguration = (section?: string) =>
                ({
                    get: (key: string, defaultValue?: unknown) =>
                        section === 'packages.python' && key === 'autoUpdateRequirements' ? false : defaultValue,
                } as unknown as vscode.WorkspaceConfiguration);

            await manager.installPackages([{ name: 'pandas' }]);
            expect(fileSystem.writeFile.calledWith(reqPath, sinon.match.any)).to.equal(false);
        });
    });
});
