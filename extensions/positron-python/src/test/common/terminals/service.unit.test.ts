// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as path from 'path';
import * as TypeMoq from 'typemoq';
import {
    Disposable,
    EventEmitter,
    TerminalShellExecution,
    TerminalShellExecutionEndEvent,
    TerminalShellIntegration,
    Terminal as VSCodeTerminal,
    WorkspaceConfiguration,
} from 'vscode';
import { ITerminalManager, IWorkspaceService } from '../../../client/common/application/types';
import { EXTENSION_ROOT_DIR } from '../../../client/common/constants';
import { IPlatformService } from '../../../client/common/platform/types';
import { TerminalService } from '../../../client/common/terminal/service';
import { ITerminalActivator, ITerminalHelper, TerminalShellType } from '../../../client/common/terminal/types';
import { IDisposableRegistry } from '../../../client/common/types';
import { IServiceContainer } from '../../../client/ioc/types';
import { ITerminalAutoActivation } from '../../../client/terminals/types';
import { createPythonInterpreter } from '../../utils/interpreters';

suite('Terminal Service', () => {
    let service: TerminalService;
    let terminal: TypeMoq.IMock<VSCodeTerminal>;
    let terminalManager: TypeMoq.IMock<ITerminalManager>;
    let terminalHelper: TypeMoq.IMock<ITerminalHelper>;
    let terminalActivator: TypeMoq.IMock<ITerminalActivator>;
    let platformService: TypeMoq.IMock<IPlatformService>;
    let workspaceService: TypeMoq.IMock<IWorkspaceService>;
    let disposables: Disposable[] = [];
    let mockServiceContainer: TypeMoq.IMock<IServiceContainer>;
    let terminalAutoActivator: TypeMoq.IMock<ITerminalAutoActivation>;
    let terminalShellIntegration: TypeMoq.IMock<TerminalShellIntegration>;
    let onDidEndTerminalShellExecutionEmitter: EventEmitter<TerminalShellExecutionEndEvent>;
    let event: TerminalShellExecutionEndEvent;

    setup(() => {
        terminal = TypeMoq.Mock.ofType<VSCodeTerminal>();
        terminalShellIntegration = TypeMoq.Mock.ofType<TerminalShellIntegration>();
        terminal.setup((t) => t.shellIntegration).returns(() => terminalShellIntegration.object);

        onDidEndTerminalShellExecutionEmitter = new EventEmitter<TerminalShellExecutionEndEvent>();
        terminalManager = TypeMoq.Mock.ofType<ITerminalManager>();
        const execution: TerminalShellExecution = {
            commandLine: {
                value: 'dummy text',
                isTrusted: true,
                confidence: 2,
            },
            cwd: undefined,
            read: function (): AsyncIterable<string> {
                throw new Error('Function not implemented.');
            },
        };

        event = {
            execution,
            exitCode: 0,
            terminal: terminal.object,
            shellIntegration: terminalShellIntegration.object,
        };

        terminalShellIntegration.setup((t) => t.executeCommand(TypeMoq.It.isAny())).returns(() => execution);

        terminalManager
            .setup((t) => t.onDidEndTerminalShellExecution)
            .returns(() => {
                setTimeout(() => onDidEndTerminalShellExecutionEmitter.fire(event), 100);
                return onDidEndTerminalShellExecutionEmitter.event;
            });
        platformService = TypeMoq.Mock.ofType<IPlatformService>();
        workspaceService = TypeMoq.Mock.ofType<IWorkspaceService>();
        terminalHelper = TypeMoq.Mock.ofType<ITerminalHelper>();
        terminalActivator = TypeMoq.Mock.ofType<ITerminalActivator>();
        terminalAutoActivator = TypeMoq.Mock.ofType<ITerminalAutoActivation>();
        disposables = [];

        mockServiceContainer = TypeMoq.Mock.ofType<IServiceContainer>();

        mockServiceContainer.setup((c) => c.get(ITerminalManager)).returns(() => terminalManager.object);
        mockServiceContainer.setup((c) => c.get(ITerminalHelper)).returns(() => terminalHelper.object);
        mockServiceContainer.setup((c) => c.get(IPlatformService)).returns(() => platformService.object);
        mockServiceContainer.setup((c) => c.get(IDisposableRegistry)).returns(() => disposables);
        mockServiceContainer.setup((c) => c.get(IWorkspaceService)).returns(() => workspaceService.object);
        mockServiceContainer.setup((c) => c.get(ITerminalActivator)).returns(() => terminalActivator.object);
        mockServiceContainer.setup((c) => c.get(ITerminalAutoActivation)).returns(() => terminalAutoActivator.object);
    });
    teardown(() => {
        if (service) {
            service.dispose();
        }
        disposables.filter((item) => !!item).forEach((item) => item.dispose());
    });

    test('Ensure terminal is disposed', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        const os: string = 'windows';
        service = new TerminalService(mockServiceContainer.object);
        const shellPath = 'powershell.exe';
        workspaceService
            .setup((w) => w.getConfiguration(TypeMoq.It.isValue('terminal.integrated.shell')))
            .returns(() => {
                const workspaceConfig = TypeMoq.Mock.ofType<WorkspaceConfiguration>();
                workspaceConfig.setup((c) => c.get(os)).returns(() => shellPath);
                return workspaceConfig.object;
            });

        platformService.setup((p) => p.isWindows).returns(() => os === 'windows');
        platformService.setup((p) => p.isLinux).returns(() => os === 'linux');
        platformService.setup((p) => p.isMac).returns(() => os === 'osx');
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);
        terminalHelper
            .setup((h) => h.buildCommandForTerminal(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => 'dummy text');

        terminalManager
            .setup((t) => t.onDidEndTerminalShellExecution)
            .returns(() => {
                setTimeout(() => onDidEndTerminalShellExecutionEmitter.fire(event), 100);
                return onDidEndTerminalShellExecutionEmitter.event;
            });
        // Sending a command will cause the terminal to be created
        await service.sendCommand('', []);

        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.atLeastOnce());
        service.dispose();
        terminal.verify((t) => t.dispose(), TypeMoq.Times.exactly(1));
    });

    test('Ensure command is sent to terminal and it is shown', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        service = new TerminalService(mockServiceContainer.object);
        const commandToSend = 'SomeCommand';
        const args = ['1', '2'];
        const commandToExpect = [commandToSend].concat(args).join(' ');
        terminalHelper
            .setup((h) => h.buildCommandForTerminal(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => commandToExpect);
        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        await service.sendCommand(commandToSend, args);

        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.atLeastOnce());
        terminal.verify(
            (t) => t.sendText(TypeMoq.It.isValue(commandToExpect), TypeMoq.It.isValue(true)),
            TypeMoq.Times.never(),
        );
    });

    test('Ensure text is sent to terminal and it is shown', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        service = new TerminalService(mockServiceContainer.object);
        const textToSend = 'Some Text';
        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        await service.sendText(textToSend);

        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.exactly(2));
        terminal.verify((t) => t.sendText(TypeMoq.It.isValue(textToSend)), TypeMoq.Times.exactly(1));
    });

    test('Ensure terminal is not shown if `hideFromUser` option is set to `true`', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        service = new TerminalService(mockServiceContainer.object, { hideFromUser: true });
        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        await service.show();

        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.never());
    });

    test('Ensure terminal shown otherwise', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        service = new TerminalService(mockServiceContainer.object);
        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        await service.show();

        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.exactly(2));
    });

    test('Ensure terminal shown and focus is set to the Terminal', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        service = new TerminalService(mockServiceContainer.object);
        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        await service.show(false);

        terminal.verify((t) => t.show(TypeMoq.It.isValue(false)), TypeMoq.Times.exactly(2));
    });

    test('Ensure PYTHONSTARTUP is injected', async () => {
        service = new TerminalService(mockServiceContainer.object);
        terminalActivator
            .setup((h) => h.activateEnvironmentInTerminal(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true))
            .verifiable(TypeMoq.Times.once());
        terminalManager
            .setup((t) => t.createTerminal(TypeMoq.It.isAny()))
            .returns(() => terminal.object)
            .verifiable(TypeMoq.Times.atLeastOnce());
        const envVarScript = path.join(EXTENSION_ROOT_DIR, 'python_files', 'pythonrc.py');
        terminalManager
            .setup((t) =>
                t.createTerminal({
                    name: TypeMoq.It.isAny(),
                    env: TypeMoq.It.isObjectWith({ PYTHONSTARTUP: envVarScript }),
                    hideFromUser: TypeMoq.It.isAny(),
                }),
            )
            .returns(() => terminal.object)
            .verifiable(TypeMoq.Times.atLeastOnce());
        await service.show();
        await service.show();
        await service.show();
        await service.show();

        terminalHelper.verifyAll();
        terminalActivator.verifyAll();
        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.atLeastOnce());
    });

    test('Ensure terminal is activated once after creation', async () => {
        service = new TerminalService(mockServiceContainer.object);
        terminalActivator
            .setup((h) => h.activateEnvironmentInTerminal(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true))
            .verifiable(TypeMoq.Times.once());
        terminalManager
            .setup((t) => t.createTerminal(TypeMoq.It.isAny()))
            .returns(() => terminal.object)
            .verifiable(TypeMoq.Times.atLeastOnce());

        await service.show();
        await service.show();
        await service.show();
        await service.show();

        terminalHelper.verifyAll();
        terminalActivator.verifyAll();
        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.atLeastOnce());
    });

    test('Ensure terminal is activated once before sending text', async () => {
        service = new TerminalService(mockServiceContainer.object);
        const textToSend = 'Some Text';
        terminalActivator
            .setup((h) => h.activateEnvironmentInTerminal(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(true))
            .verifiable(TypeMoq.Times.once());
        terminalManager
            .setup((t) => t.createTerminal(TypeMoq.It.isAny()))
            .returns(() => terminal.object)
            .verifiable(TypeMoq.Times.atLeastOnce());

        await service.sendText(textToSend);
        await service.sendText(textToSend);
        await service.sendText(textToSend);
        await service.sendText(textToSend);

        terminalHelper.verifyAll();
        terminalActivator.verifyAll();
        terminal.verify((t) => t.show(TypeMoq.It.isValue(true)), TypeMoq.Times.atLeastOnce());
    });

    test('Ensure close event is not fired when another terminal is closed', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        let eventFired = false;
        let eventHandler: undefined | (() => void);
        terminalManager
            .setup((m) => m.onDidCloseTerminal(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((handler) => {
                eventHandler = handler;

                return { dispose: () => {} };
            });
        service = new TerminalService(mockServiceContainer.object);
        service.onDidCloseTerminal(() => (eventFired = true), service);
        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        // This will create the terminal.
        await service.sendText('blah');

        expect(eventHandler).not.to.be.an('undefined', 'event handler not initialized');
        eventHandler!.bind(service)();
        expect(eventFired).to.be.equal(false, 'Event fired');
    });

    test('Ensure close event is not fired when terminal is closed', async () => {
        terminalHelper
            .setup((helper) => helper.getEnvironmentActivationCommands(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        let eventFired = false;
        let eventHandler: undefined | ((t: VSCodeTerminal) => void);
        terminalManager
            .setup((m) => m.onDidCloseTerminal(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((handler) => {
                eventHandler = handler;

                return { dispose: () => {} };
            });
        service = new TerminalService(mockServiceContainer.object);
        service.onDidCloseTerminal(() => (eventFired = true));

        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        // This will create the terminal.
        await service.sendText('blah');

        expect(eventHandler).not.to.be.an('undefined', 'event handler not initialized');
        eventHandler!.bind(service)(terminal.object);
        expect(eventFired).to.be.equal(true, 'Event not fired');
    });
    test('Ensure to disable auto activation and right interpreter is activated', async () => {
        const interpreter = createPythonInterpreter({ path: 'abc' });
        service = new TerminalService(mockServiceContainer.object, { interpreter });

        terminalHelper.setup((h) => h.identifyTerminalShell(TypeMoq.It.isAny())).returns(() => TerminalShellType.bash);
        terminalManager.setup((t) => t.createTerminal(TypeMoq.It.isAny())).returns(() => terminal.object);

        // This will create the terminal.
        await service.sendText('blah');

        // Ensure we disable auto activation of the terminal.
        terminalAutoActivator.verify((t) => t.disableAutoActivation(terminal.object), TypeMoq.Times.once());
        // Ensure the terminal is activated with the interpreter info.
        terminalActivator.verify(
            (t) => t.activateEnvironmentInTerminal(terminal.object, TypeMoq.It.isObjectWith({ interpreter })),
            TypeMoq.Times.once(),
        );
    });
});
