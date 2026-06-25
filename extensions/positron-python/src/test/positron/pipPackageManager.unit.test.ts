/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { IPythonExecutionFactory } from '../../client/common/process/types';
import { ITerminalServiceFactory } from '../../client/common/terminal/types';
import { IFileSystem } from '../../client/common/platform/types';
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
    let fileSystem: { createTemporaryFile: sinon.SinonStub; writeFile: sinon.SinonStub };
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
        pythonService.execModule
            .withArgs('pip', sinon.match.array.startsWith(['freeze']))
            .resolves({
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
            createTemporaryFile: sinon.stub().resolves({ filePath: '/tmp/reqs.txt', dispose: sinon.stub() }),
            writeFile: sinon.stub().callsFake((_p: string, text: string) => {
                writtenContent = text;
                return Promise.resolve();
            }),
        };

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
            .returns(fileSystem);

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

        expect(writtenContent).to.contain('werkzeug==3.1.8');        // target pinned
        expect(writtenContent).to.contain('flask');                 // other PyPI -> bare
        expect(writtenContent).to.not.contain('flask==2.2.0');      // not pinned
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

        expect(writtenContent).to.contain('werkzeug');                 // bare, no pin
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
});
