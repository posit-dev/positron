/* eslint-disable @typescript-eslint/no-empty-function */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { interfaces } from 'inversify';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../client/common/process/types';
import { ITerminalService, ITerminalServiceFactory } from '../../client/common/terminal/types';
import { IServiceContainer } from '../../client/ioc/types';
import { PipPackageManager } from '../../client/positron/packages/pipPackageManager';
import { MessageEmitter, PackageSession } from '../../client/positron/packages/types';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import { mock } from './utils';

suite('Pip Package Manager', () => {
    let pipPackageManager: PipPackageManager;
    let serviceContainer: IServiceContainer;
    let pythonExecutionService: IPythonExecutionService;
    let pythonExecutionFactory: IPythonExecutionFactory;
    let terminalService: ITerminalService;
    let messageEmitter: MessageEmitter;
    let session: PackageSession;
    let sendCommandStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;
    let cancellationToken: vscode.CancellationToken;

    const pythonPath = '/path/to/python';

    setup(() => {
        cancellationToken = new vscode.CancellationTokenSource().token;
        sendCommandStub = sinon.stub().resolves();

        // Mock workspace.getConfiguration to return empty proxy config
        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake(() => ({
            get: () => '',
        }));

        pythonExecutionService = mock<IPythonExecutionService>({
            isModuleInstalled: () => Promise.resolve(true),
            execModule: () => Promise.resolve({ stdout: '[]', stderr: '' }),
        });

        pythonExecutionFactory = mock<IPythonExecutionFactory>({
            create: () => Promise.resolve(pythonExecutionService),
        });

        terminalService = mock<ITerminalService>({
            show: () => Promise.resolve(),
            sendCommand: sendCommandStub,
            sendText: () => Promise.resolve(),
        });

        const terminalServiceFactory = mock<ITerminalServiceFactory>({
            getTerminalService: () => terminalService,
        });

        serviceContainer = mock<IServiceContainer>({
            get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                switch (serviceIdentifier) {
                    case IPythonExecutionFactory:
                        return pythonExecutionFactory as T;
                    case ITerminalServiceFactory:
                        return terminalServiceFactory as T;
                    default:
                        return undefined as T;
                }
            },
        });

        messageEmitter = mock<MessageEmitter>({
            fire: () => {},
        });

        session = mock<PackageSession>({
            metadata: { sessionId: 'test-session-id' },
            callMethod: () => Promise.resolve([]),
        });

        pipPackageManager = new PipPackageManager(pythonPath, messageEmitter, serviceContainer, session);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('installPackages', () => {
        test('installs single package with pip install', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }];

            await pipPackageManager.installPackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, pythonPath);
            assert.deepStrictEqual(args, ['-m', 'pip', 'install', 'numpy']);
        });

        test('installs multiple packages', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }, { name: 'pandas' }];

            await pipPackageManager.installPackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['-m', 'pip', 'install', 'numpy', 'pandas']);
        });

        test('installs package with specific version', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy', version: '1.24.0' }];

            await pipPackageManager.installPackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['-m', 'pip', 'install', 'numpy==1.24.0']);
        });

        test('does nothing for empty package list', async () => {
            await pipPackageManager.installPackages([], cancellationToken);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('uninstallPackages', () => {
        test('uninstalls single package with pip uninstall', async () => {
            await pipPackageManager.uninstallPackages(['numpy'], cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, pythonPath);
            assert.deepStrictEqual(args, ['-m', 'pip', 'uninstall', '-y', 'numpy']);
        });

        test('uninstalls multiple packages', async () => {
            await pipPackageManager.uninstallPackages(['numpy', 'pandas'], cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['-m', 'pip', 'uninstall', '-y', 'numpy', 'pandas']);
        });

        test('does nothing for empty package list', async () => {
            await pipPackageManager.uninstallPackages([], cancellationToken);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('updatePackages', () => {
        test('updates single package with pip install --upgrade', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }];

            await pipPackageManager.updatePackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, pythonPath);
            assert.deepStrictEqual(args, ['-m', 'pip', 'install', '--upgrade', 'numpy']);
        });

        test('does nothing for empty package list', async () => {
            await pipPackageManager.updatePackages([], cancellationToken);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('syncFromRequirements', () => {
        let getWorkspaceFoldersStub: sinon.SinonStub;

        setup(() => {
            getWorkspaceFoldersStub = sinon.stub(workspaceApis, 'getWorkspaceFolders');
        });

        test('throws error when no workspace folder', async () => {
            getWorkspaceFoldersStub.returns(undefined);

            await assert.rejects(
                () => pipPackageManager.syncFromRequirements(cancellationToken),
                /No requirements.txt file found/,
            );
        });

        test('throws error when workspace folders is empty', async () => {
            getWorkspaceFoldersStub.returns([]);

            await assert.rejects(
                () => pipPackageManager.syncFromRequirements(cancellationToken),
                /No requirements.txt file found/,
            );
        });
    });

    suite('supportsSyncFromRequirements', () => {
        let getWorkspaceFoldersStub: sinon.SinonStub;

        setup(() => {
            getWorkspaceFoldersStub = sinon.stub(workspaceApis, 'getWorkspaceFolders');
        });

        test('returns false when no workspace folder', async () => {
            getWorkspaceFoldersStub.returns(undefined);

            const result = await pipPackageManager.supportsSyncFromRequirements();

            assert.strictEqual(result, false);
        });

        test('returns false when workspace folders is empty', async () => {
            getWorkspaceFoldersStub.returns([]);

            const result = await pipPackageManager.supportsSyncFromRequirements();

            assert.strictEqual(result, false);
        });
    });

    suite('error handling', () => {
        test('throws error when pip is not available', async () => {
            pythonExecutionService = mock<IPythonExecutionService>({
                isModuleInstalled: () => Promise.resolve(false),
            });

            pythonExecutionFactory = mock<IPythonExecutionFactory>({
                create: () => Promise.resolve(pythonExecutionService),
            });

            serviceContainer = mock<IServiceContainer>({
                get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                    switch (serviceIdentifier) {
                        case IPythonExecutionFactory:
                            return pythonExecutionFactory as T;
                        case ITerminalServiceFactory:
                            return mock<ITerminalServiceFactory>({
                                getTerminalService: () => terminalService,
                            }) as T;
                        default:
                            return undefined as T;
                    }
                },
            });

            pipPackageManager = new PipPackageManager(pythonPath, messageEmitter, serviceContainer, session);

            await assert.rejects(
                () => pipPackageManager.installPackages([{ name: 'numpy' }], cancellationToken),
                /pip is not available/,
            );
        });

        test('throws CancellationError when token is cancelled before install', async () => {
            const cancelledToken = { isCancellationRequested: true } as vscode.CancellationToken;

            await assert.rejects(
                () => pipPackageManager.installPackages([{ name: 'numpy' }], cancelledToken),
                (err: Error) => err instanceof vscode.CancellationError,
            );
        });
    });

    suite('isPipAvailable', () => {
        test('returns true when pip module is installed', async () => {
            const result = await pipPackageManager.isPipAvailable();

            assert.strictEqual(result, true);
        });

        test('returns false when pip module is not installed', async () => {
            pythonExecutionService = mock<IPythonExecutionService>({
                isModuleInstalled: () => Promise.resolve(false),
            });

            pythonExecutionFactory = mock<IPythonExecutionFactory>({
                create: () => Promise.resolve(pythonExecutionService),
            });

            serviceContainer = mock<IServiceContainer>({
                get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                    switch (serviceIdentifier) {
                        case IPythonExecutionFactory:
                            return pythonExecutionFactory as T;
                        default:
                            return undefined as T;
                    }
                },
            });

            pipPackageManager = new PipPackageManager(pythonPath, messageEmitter, serviceContainer, session);

            const result = await pipPackageManager.isPipAvailable();

            assert.strictEqual(result, false);
        });
    });
});
