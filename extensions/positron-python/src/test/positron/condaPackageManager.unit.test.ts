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
import { ITerminalService, ITerminalServiceFactory } from '../../client/common/terminal/types';
import { IComponentAdapter, ICondaService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { IProcessService, IProcessServiceFactory } from '../../client/common/process/types';
import {
    CondaPackageManager,
    parseCondaLinkedVersion,
    parseCondaListedVersion,
} from '../../client/positron/packages/condaPackageManager';
import { MessageEmitter, PackageSession } from '../../client/positron/packages/types';
import { mock } from './utils';

suite('Conda Package Manager', () => {
    let condaPackageManager: CondaPackageManager;
    let serviceContainer: IServiceContainer;
    let condaService: ICondaService;
    let componentAdapter: IComponentAdapter;
    let terminalService: ITerminalService;
    let messageEmitter: MessageEmitter;
    let session: PackageSession;
    let sendCommandStub: sinon.SinonStub;
    let cancellationToken: vscode.CancellationToken;

    const pythonPath = '/path/to/conda/envs/myenv/bin/python';
    const condaEnvPath = '/path/to/conda/envs/myenv';
    const condaFile = '/path/to/conda';

    setup(() => {
        cancellationToken = new vscode.CancellationTokenSource().token;
        sendCommandStub = sinon.stub().resolves();

        terminalService = mock<ITerminalService>({
            show: () => Promise.resolve(),
            sendCommand: sendCommandStub,
        });

        const terminalServiceFactory = mock<ITerminalServiceFactory>({
            getTerminalService: () => terminalService,
        });

        condaService = mock<ICondaService>({
            isCondaAvailable: () => Promise.resolve(true),
            getCondaFile: () => Promise.resolve(condaFile),
        });

        componentAdapter = mock<IComponentAdapter>({
            getCondaEnvironment: () => Promise.resolve({ name: 'myenv', path: condaEnvPath }),
        });

        serviceContainer = mock<IServiceContainer>({
            get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                switch (serviceIdentifier) {
                    case ICondaService:
                        return condaService as T;
                    case IComponentAdapter:
                        return componentAdapter as T;
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
            callMethod: () => Promise.resolve([]),
        });

        condaPackageManager = new CondaPackageManager(pythonPath, messageEmitter, serviceContainer, session);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('installPackages', () => {
        test('installs single package with conda install', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }];

            await condaPackageManager.installPackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, condaFile);
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy']);
        });

        test('installs multiple packages', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }, { name: 'pandas' }];

            await condaPackageManager.installPackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy', 'pandas']);
        });

        test('installs package with specific version', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy', version: '1.24.0' }];

            await condaPackageManager.installPackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy==1.24.0']);
        });

        test('does nothing for empty package list', async () => {
            await condaPackageManager.installPackages([], cancellationToken);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('uninstallPackages', () => {
        test('uninstalls single package with conda remove', async () => {
            await condaPackageManager.uninstallPackages(['numpy'], cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, condaFile);
            assert.deepStrictEqual(args, ['remove', '--prefix', condaEnvPath, '-y', 'numpy']);
        });

        test('uninstalls multiple packages', async () => {
            await condaPackageManager.uninstallPackages(['numpy', 'pandas'], cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['remove', '--prefix', condaEnvPath, '-y', 'numpy', 'pandas']);
        });

        test('does nothing for empty package list', async () => {
            await condaPackageManager.uninstallPackages([], cancellationToken);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('updatePackages', () => {
        test('updates single package with conda update', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }];

            await condaPackageManager.updatePackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, condaFile);
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy']);
        });

        test('updates multiple packages', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }, { name: 'pandas' }];

            await condaPackageManager.updatePackages(packages, cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy', 'pandas']);
        });

        test('does nothing for empty package list', async () => {
            await condaPackageManager.updatePackages([], cancellationToken);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('updateAllPackages', () => {
        test('updates all packages with conda update --all', async () => {
            await condaPackageManager.updateAllPackages(cancellationToken);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, condaFile);
            assert.deepStrictEqual(args, ['update', '--prefix', condaEnvPath, '--all', '-y']);
        });
    });

    suite('error handling', () => {
        test('throws error when conda is not available', async () => {
            condaService = mock<ICondaService>({
                isCondaAvailable: () => Promise.resolve(false),
                getCondaFile: () => Promise.resolve(condaFile),
            });

            serviceContainer = mock<IServiceContainer>({
                get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                    switch (serviceIdentifier) {
                        case ICondaService:
                            return condaService as T;
                        case IComponentAdapter:
                            return componentAdapter as T;
                        case ITerminalServiceFactory:
                            return mock<ITerminalServiceFactory>({
                                getTerminalService: () => terminalService,
                            }) as T;
                        default:
                            return undefined as T;
                    }
                },
            });

            condaPackageManager = new CondaPackageManager(pythonPath, messageEmitter, serviceContainer, session);

            await assert.rejects(
                () => condaPackageManager.installPackages([{ name: 'numpy' }], cancellationToken),
                /conda is not available/,
            );
        });

        test('throws error when environment prefix cannot be determined', async () => {
            componentAdapter = mock<IComponentAdapter>({
                getCondaEnvironment: () => Promise.resolve(undefined),
            });

            serviceContainer = mock<IServiceContainer>({
                get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                    switch (serviceIdentifier) {
                        case ICondaService:
                            return condaService as T;
                        case IComponentAdapter:
                            return componentAdapter as T;
                        case ITerminalServiceFactory:
                            return mock<ITerminalServiceFactory>({
                                getTerminalService: () => terminalService,
                            }) as T;
                        default:
                            return undefined as T;
                    }
                },
            });

            condaPackageManager = new CondaPackageManager(pythonPath, messageEmitter, serviceContainer, session);

            await assert.rejects(
                () => condaPackageManager.installPackages([{ name: 'numpy' }], cancellationToken),
                /Could not determine conda environment path/,
            );
        });
    });
});

suite('parseCondaLinkedVersion', () => {
    test('reads the version conda said it would link', () => {
        const json = JSON.stringify({
            actions: { LINK: [{ name: 'python', version: '3.12.8' }, { name: 'numpy', version: '2.2.1' }] },
            success: true,
        });

        assert.strictEqual(parseCondaLinkedVersion(json, 'numpy'), '2.2.1');
    });

    test('matches the requested name however it is spelled', () => {
        const json = JSON.stringify({ actions: { LINK: [{ name: 'ruamel-yaml', version: '0.18.6' }] } });

        assert.strictEqual(parseCondaLinkedVersion(json, 'ruamel.yaml'), '0.18.6');
    });

    // Conda says this when the environment already has the package at the newest
    // version. It is not an error, so the caller decides what to do next.
    test('returns undefined when conda reports nothing to do', () => {
        const json = JSON.stringify({ message: 'All requested packages already installed.', success: true });

        assert.strictEqual(parseCondaLinkedVersion(json, 'numpy'), undefined);
    });

    test('returns undefined rather than throwing on unusable output', () => {
        assert.strictEqual(parseCondaLinkedVersion('not json at all', 'numpy'), undefined);
        assert.strictEqual(parseCondaLinkedVersion('{"actions": {"LINK": "nope"}}', 'numpy'), undefined);
        assert.strictEqual(parseCondaLinkedVersion('{}', 'numpy'), undefined);
    });
});

suite('parseCondaListedVersion', () => {
    test('reads a package version out of the environment listing', () => {
        const json = JSON.stringify([
            { name: 'numpy', version: '2.2.1' },
            { name: 'pandas', version: '2.2.3' },
        ]);

        assert.strictEqual(parseCondaListedVersion(json, 'pandas'), '2.2.3');
    });

    test('returns undefined when the package is not installed', () => {
        assert.strictEqual(parseCondaListedVersion('[]', 'numpy'), undefined);
        assert.strictEqual(parseCondaListedVersion('not json at all', 'numpy'), undefined);
    });
});

suite('Conda Package Manager resolveInstallVersion', () => {
    let condaPackageManager: CondaPackageManager;
    let execStub: sinon.SinonStub;

    const pythonPath = '/path/to/conda/envs/myenv/bin/python';

    setup(() => {
        execStub = sinon.stub();

        const serviceContainer = mock<IServiceContainer>({
            get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                switch (serviceIdentifier) {
                    case ICondaService:
                        return mock<ICondaService>({
                            isCondaAvailable: () => Promise.resolve(true),
                            getCondaFile: () => Promise.resolve('/path/to/conda'),
                        }) as T;
                    case IComponentAdapter:
                        return mock<IComponentAdapter>({
                            getCondaEnvironment: () =>
                                Promise.resolve({ name: 'myenv', path: '/path/to/conda/envs/myenv' }),
                        }) as T;
                    case IProcessServiceFactory:
                        return mock<IProcessServiceFactory>({
                            create: () => Promise.resolve(mock<IProcessService>({ exec: execStub })),
                        }) as T;
                    default:
                        return undefined as T;
                }
            },
        });

        condaPackageManager = new CondaPackageManager(
            pythonPath,
            mock<MessageEmitter>({ fire: () => {} }),
            serviceContainer,
            mock<PackageSession>({ callMethod: () => Promise.resolve([]) }),
        );
    });

    teardown(() => {
        sinon.restore();
    });

    // The reason this asks the solver rather than reading `conda search`: search
    // results are ordered by upload time, so a rebuild of an older version
    // published later would come out on top of the newer one.
    test('asks the solver what it would link, not conda search', async () => {
        execStub.resolves({
            stdout: JSON.stringify({ actions: { LINK: [{ name: 'numpy', version: '2.2.1' }] } }),
            stderr: '',
        });

        const version = await condaPackageManager.resolveInstallVersion('numpy');

        assert.strictEqual(version, '2.2.1');
        const [, args] = execStub.firstCall.args;
        assert.deepStrictEqual(args, ['install', '--dry-run', '--json', 'numpy']);
    });

    test('falls back to the installed version when conda has nothing to link', async () => {
        execStub
            .onFirstCall()
            .resolves({ stdout: JSON.stringify({ message: 'All requested packages already installed.' }), stderr: '' })
            .onSecondCall()
            .resolves({ stdout: JSON.stringify([{ name: 'numpy', version: '2.2.1' }]), stderr: '' });

        const version = await condaPackageManager.resolveInstallVersion('numpy');

        assert.strictEqual(version, '2.2.1');
        assert.deepStrictEqual(execStub.secondCall.args[1], ['list', 'numpy', '--json']);
    });

    test('resolves undefined when conda cannot solve for the package', async () => {
        execStub.rejects(new Error('PackagesNotFoundError'));

        assert.strictEqual(await condaPackageManager.resolveInstallVersion('asdasdadfasdf'), undefined);
    });

    test('rejects before running conda when the token is already canceled', async () => {
        const source = new vscode.CancellationTokenSource();
        source.cancel();

        await assert.rejects(() => condaPackageManager.resolveInstallVersion('numpy', source.token));
        assert.strictEqual(execStub.called, false);
    });
});
