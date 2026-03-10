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
import { ITerminalService, ITerminalServiceFactory } from '../../client/common/terminal/types';
import { IComponentAdapter, ICondaService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { CondaPackageManager } from '../../client/positron/packages/condaPackageManager';
import { MessageEmitter, PackageKernel } from '../../client/positron/packages/types';
import { mock } from './utils';

suite('Conda Package Manager', () => {
    let condaPackageManager: CondaPackageManager;
    let serviceContainer: IServiceContainer;
    let condaService: ICondaService;
    let componentAdapter: IComponentAdapter;
    let terminalService: ITerminalService;
    let messageEmitter: MessageEmitter;
    let kernel: PackageKernel;
    let sendCommandStub: sinon.SinonStub;

    const pythonPath = '/path/to/conda/envs/myenv/bin/python';
    const condaEnvPath = '/path/to/conda/envs/myenv';
    const condaFile = '/path/to/conda';

    setup(() => {
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

        kernel = mock<PackageKernel>({
            callMethod: () => Promise.resolve([]),
        });

        condaPackageManager = new CondaPackageManager(pythonPath, messageEmitter, serviceContainer, kernel);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('installPackages', () => {
        test('installs single package with conda install', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }];

            await condaPackageManager.installPackages(packages);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, condaFile);
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy']);
        });

        test('installs multiple packages', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }, { name: 'pandas' }];

            await condaPackageManager.installPackages(packages);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy', 'pandas']);
        });

        test('installs package with specific version', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy', version: '1.24.0' }];

            await condaPackageManager.installPackages(packages);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy==1.24.0']);
        });

        test('does nothing for empty package list', async () => {
            await condaPackageManager.installPackages([]);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('uninstallPackages', () => {
        test('uninstalls single package with conda remove', async () => {
            await condaPackageManager.uninstallPackages(['numpy']);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, condaFile);
            assert.deepStrictEqual(args, ['remove', '--prefix', condaEnvPath, '-y', 'numpy']);
        });

        test('uninstalls multiple packages', async () => {
            await condaPackageManager.uninstallPackages(['numpy', 'pandas']);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['remove', '--prefix', condaEnvPath, '-y', 'numpy', 'pandas']);
        });

        test('does nothing for empty package list', async () => {
            await condaPackageManager.uninstallPackages([]);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('updatePackages', () => {
        test('updates single package with conda update', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }];

            await condaPackageManager.updatePackages(packages);

            sinon.assert.calledOnce(sendCommandStub);
            const [executable, args] = sendCommandStub.firstCall.args;
            assert.strictEqual(executable, condaFile);
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy']);
        });

        test('updates multiple packages', async () => {
            const packages: positron.PackageSpec[] = [{ name: 'numpy' }, { name: 'pandas' }];

            await condaPackageManager.updatePackages(packages);

            sinon.assert.calledOnce(sendCommandStub);
            const [, args] = sendCommandStub.firstCall.args;
            assert.deepStrictEqual(args, ['install', '--prefix', condaEnvPath, '-y', 'numpy', 'pandas']);
        });

        test('does nothing for empty package list', async () => {
            await condaPackageManager.updatePackages([]);

            sinon.assert.notCalled(sendCommandStub);
        });
    });

    suite('updateAllPackages', () => {
        test('updates all packages with conda update --all', async () => {
            await condaPackageManager.updateAllPackages();

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

            condaPackageManager = new CondaPackageManager(pythonPath, messageEmitter, serviceContainer, kernel);

            await assert.rejects(
                () => condaPackageManager.installPackages([{ name: 'numpy' }]),
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

            condaPackageManager = new CondaPackageManager(pythonPath, messageEmitter, serviceContainer, kernel);

            await assert.rejects(
                () => condaPackageManager.installPackages([{ name: 'numpy' }]),
                /Could not determine conda environment path/,
            );
        });
    });
});
