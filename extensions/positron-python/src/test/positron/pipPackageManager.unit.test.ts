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
    let writtenContent: string;
    let workspaceService: { workspaceFolders: Array<{ uri: { fsPath: string } }> | undefined };
    let reqExists: boolean;
    let reqContent: string;
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

        reqExists = false;
        reqContent = '';
        writtenContent = '';
        fileSystem = {
            createTemporaryFile: sinon.stub().resolves({ filePath: '/tmp/reqs.txt', dispose: sinon.stub() }),
            writeFile: sinon.stub().callsFake((_p: string, text: string) => {
                writtenContent = text;
                return Promise.resolve();
            }),
            fileExists: sinon
                .stub()
                .callsFake((p: string) => Promise.resolve(p.endsWith('requirements.txt') ? reqExists : false)),
            readFile: sinon.stub().callsFake(() => Promise.resolve(reqContent)),
        } as any;

        workspaceService = { workspaceFolders: [{ uri: { fsPath: '/work' } }] };

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

    test('updateAllPackages writes a bare requirements file and runs install --upgrade -r (freeze fallback path)', async () => {
        reqExists = false; // freeze fallback path
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

    test('updateAllPackages does nothing when no packages are outdated (freeze fallback path)', async () => {
        reqExists = false; // ensure freeze-fallback path is exercised (not requirements.txt path)
        pythonService.execModule
            .withArgs('pip', sinon.match.array.startsWith(['list', '--outdated']))
            .resolves({ stdout: '[]', stderr: '' });

        await manager.updateAllPackages();

        expect(terminalService.sendCommand.called).to.equal(false);
    });

    test('updateAllPackages upgrades against requirements.txt directly when present', async () => {
        reqExists = true;
        // Do NOT stub list --outdated: the requirements.txt path must skip it entirely.

        await manager.updateAllPackages();

        const [, args] = terminalService.sendCommand.firstCall.args;
        expect(args).to.include.members(['install', '--upgrade', '-r', '/work/requirements.txt']);
        // No temp file, no write-back.
        expect((fileSystem.createTemporaryFile as sinon.SinonStub).called).to.equal(false);
        expect((fileSystem.writeFile as sinon.SinonStub).calledWith('/work/requirements.txt')).to.equal(false);
        // _getOutdatedPackages must NOT have been called on this path.
        const outdatedCalled = (pythonService.execModule as sinon.SinonStub)
            .getCalls()
            .some((c) => Array.isArray(c.args[1]) && c.args[1][0] === 'list' && c.args[1][1] === '--outdated');
        expect(outdatedCalled).to.equal(false);
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

    test('_getRequirementsPath finds a root requirements.txt when present', async () => {
        reqExists = true;
        // Access the private helper through an `any` cast (no public surface yet).
        const p = await (manager as any)._getRequirementsPath();
        expect(p).to.equal('/work/requirements.txt');
    });

    test('_getRequirementsPath returns undefined when absent', async () => {
        reqExists = false;
        const p = await (manager as any)._getRequirementsPath();
        expect(p).to.equal(undefined);
    });

    test('_confirmAndWriteBack writes the edited content when the package is present', async () => {
        reqContent = 'flask==1.0\n';
        (session.callMethod as sinon.SinonStub).resolves([{ name: 'requests', version: '2.31.0' }]);
        await (manager as any)._confirmAndWriteBack(
            '/work/requirements.txt',
            'requests',
            true,
            (c: string) => c + 'requests\n',
        );
        expect(fileSystem.writeFile.calledWith('/work/requirements.txt', 'flask==1.0\nrequests\n')).to.equal(true);
    });

    test('_confirmAndWriteBack skips the write when presence check fails', async () => {
        (session.callMethod as sinon.SinonStub).resolves([]); // requests not installed
        await (manager as any)._confirmAndWriteBack(
            '/work/requirements.txt',
            'requests',
            true,
            (c: string) => c + 'requests\n',
        );
        expect((fileSystem.writeFile as sinon.SinonStub).called).to.equal(false);
    });

    test('installPackages resolves against requirements.txt when present', async () => {
        reqExists = true;
        reqContent = 'flask==2.2.0\n';
        (session.callMethod as sinon.SinonStub).resolves([{ name: 'cowsay', version: '6.1' }]);

        await manager.installPackages([{ name: 'cowsay', version: '6.1' }]);

        // Op copy = requirements.txt with the target pinned, freeze NOT consulted.
        const tempWrite = (fileSystem.writeFile as sinon.SinonStub)
            .getCalls()
            .find((c) => c.args[0] === '/tmp/reqs.txt');
        expect(tempWrite!.args[1]).to.equal('flask==2.2.0\ncowsay==6.1\n');
        const [, args] = terminalService.sendCommand.firstCall.args;
        expect(args).to.include.members(['install', '-r', '/tmp/reqs.txt']);
        // Write-back records a BARE name even though a version was picked.
        expect(fileSystem.writeFile.calledWith('/work/requirements.txt', 'flask==2.2.0\ncowsay\n')).to.equal(true);
    });

    test('installPackages (no requirements.txt) keeps the freeze fallback', async () => {
        reqExists = false;
        await manager.installPackages([{ name: 'cowsay', version: '6.1' }]);
        // freeze-derived content still names flask bare + origin verbatim.
        expect(writtenContent).to.contain('cowsay==6.1');
        expect(writtenContent).to.contain('positron-update-demo @ file:///tmp/demo');
        expect((fileSystem.writeFile as sinon.SinonStub).calledWith('/work/requirements.txt')).to.equal(false);
    });

    test('updatePackages resolves against requirements.txt and bumps an exact pin', async () => {
        reqExists = true;
        reqContent = 'flask==2.2.0\nwerkzeug==2.0.3\n';
        (session.callMethod as sinon.SinonStub).resolves([{ name: 'werkzeug', version: '3.1.8' }]);

        await manager.updatePackages([{ name: 'werkzeug', version: '3.1.8' }]);

        const tempWrite = (fileSystem.writeFile as sinon.SinonStub)
            .getCalls()
            .find((c) => c.args[0] === '/tmp/reqs.txt');
        expect(tempWrite!.args[1]).to.equal('flask==2.2.0\nwerkzeug==3.1.8\n'); // op copy: only target re-pinned
        const [, args] = terminalService.sendCommand.firstCall.args;
        expect(args).to.include.members(['install', '-r', '/tmp/reqs.txt']);
        expect(args).to.not.include('--upgrade');
        // Write-back bumps the existing exact pin.
        expect(fileSystem.writeFile.calledWith('/work/requirements.txt', 'flask==2.2.0\nwerkzeug==3.1.8\n')).to.equal(
            true,
        );
    });

    test('updatePackages leaves a declared range untouched on write-back', async () => {
        reqExists = true;
        reqContent = 'werkzeug>=2,<4\n';
        (session.callMethod as sinon.SinonStub).resolves([{ name: 'werkzeug', version: '3.1.8' }]);

        await manager.updatePackages([{ name: 'werkzeug', version: '3.1.8' }]);

        // No write-back edit (range still satisfied) -> requirements.txt not rewritten.
        expect((fileSystem.writeFile as sinon.SinonStub).calledWith('/work/requirements.txt')).to.equal(false);
    });

    test('updatePackages still requires a version', async () => {
        reqExists = true;
        let threw = false;
        try {
            await manager.updatePackages([{ name: 'werkzeug' }]);
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
    });

    test('uninstallPackages removes the entry from requirements.txt', async () => {
        reqExists = true;
        reqContent = 'flask==2.2.0\nrequests==2.28.0\n';
        (session.callMethod as sinon.SinonStub).resolves([{ name: 'flask', version: '2.2.0' }]); // requests gone

        await manager.uninstallPackages(['requests']);

        const [, args] = terminalService.sendCommand.firstCall.args;
        expect(args).to.include.members(['uninstall', '-y', 'requests']);
        expect(fileSystem.writeFile.calledWith('/work/requirements.txt', 'flask==2.2.0\n')).to.equal(true);
    });

    test('uninstallPackages (no requirements.txt) does not write back', async () => {
        reqExists = false;
        await manager.uninstallPackages(['requests']);
        expect((fileSystem.writeFile as sinon.SinonStub).calledWith('/work/requirements.txt')).to.equal(false);
    });
});
