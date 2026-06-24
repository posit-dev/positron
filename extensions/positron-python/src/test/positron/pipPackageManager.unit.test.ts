/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as sinon from 'sinon';
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

    setup(() => {
        pythonService = {
            isModuleInstalled: sinon.stub().resolves(true),
            execModule: sinon.stub(),
        };
        // Default freeze output; individual tests can override.
        pythonService.execModule
            .withArgs('pip', sinon.match.array.startsWith(['freeze']))
            .resolves({ stdout: 'werkzeug==2.0.3\npositron-update-demo @ file:///tmp/demo\n', stderr: '' });

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

    teardown(() => sinon.restore());

    test('updatePackages installs a pinned requirements file naming all packages', async () => {
        await manager.updatePackages([{ name: 'werkzeug', version: '3.1.8' }]);

        // The freeze line for the target is replaced; constraining package is kept.
        expect(writtenContent).to.contain('werkzeug==3.1.8');
        expect(writtenContent).to.contain('positron-update-demo @ file:///tmp/demo');
        expect(writtenContent).to.not.contain('werkzeug==2.0.3');

        // The terminal runs `pip install -r <tempfile>`, not a bare --upgrade.
        const [pythonPath, args] = terminalService.sendCommand.firstCall.args;
        expect(pythonPath).to.equal('/path/to/python');
        expect(args).to.include.members(['-m', 'pip', 'install', '-r', '/tmp/reqs.txt']);
        expect(args).to.not.include('--upgrade');
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
});
