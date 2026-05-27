/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import * as windowApis from '../../../../client/common/vscodeApis/windowApis';
import * as commandApis from '../../../../client/common/vscodeApis/commandApis';
import * as rawProcessApis from '../../../../client/common/process/rawProcessApis';
import * as venvUtils from '../../../../client/pythonEnvironments/creation/provider/venvUtils';
import * as triggerUtils from '../../../../client/pythonEnvironments/creation/common/createEnvTriggerUtils';
import {
    AutoCreateVenvContext,
    autoCreateVenvWithDeps,
    uvInstallDeps,
} from '../../../../client/pythonEnvironments/creation/provider/autoCreateVenv';
import { UV_PROVIDER_ID } from '../../../../client/pythonEnvironments/creation/provider/uvCreationProvider';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../constants';
import { CreateEnvironmentProgress } from '../../../../client/pythonEnvironments/creation/types';
import { Observable } from 'rxjs';
import { Output } from '../../../../client/common/process/types';

suite('Auto Create Venv', () => {
    const workspace = {
        uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
        name: 'workspace1',
        index: 0,
    };

    let getPipRequirementsFilesStub: sinon.SinonStub;
    let hasPyprojectTomlStub: sinon.SinonStub;
    let showQuickPickWithBackStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;
    let execObservableStub: sinon.SinonStub;

    setup(() => {
        getPipRequirementsFilesStub = sinon.stub(venvUtils, 'getPipRequirementsFiles');
        hasPyprojectTomlStub = sinon.stub(triggerUtils, 'hasPyprojectToml');
        showQuickPickWithBackStub = sinon.stub(windowApis, 'showQuickPickWithBack');
        executeCommandStub = sinon.stub(commandApis, 'executeCommand');
        execObservableStub = sinon.stub(rawProcessApis, 'execObservable');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('autoCreateVenvWithDeps', () => {
        test('Single requirements.txt: routes to uv provider, no quickpick', async () => {
            const reqPath = path.join(workspace.uri.fsPath, 'requirements.txt');
            getPipRequirementsFilesStub.resolves([reqPath]);
            hasPyprojectTomlStub.resolves(false);
            executeCommandStub.resolves({ path: '/some/.venv/bin/python' });

            const ctx: AutoCreateVenvContext = { hasRequirements: true, hasPyprojectToml: false, uvAvailable: true };
            await autoCreateVenvWithDeps(workspace, ctx);

            sinon.assert.notCalled(showQuickPickWithBackStub);
            const options = executeCommandStub.firstCall.args[1];
            assert.deepStrictEqual(
                {
                    providerId: options.providerId,
                    uvPythonVersion: options.uvPythonVersion,
                    installPackages: options.installPackages,
                },
                { providerId: UV_PROVIDER_ID, uvPythonVersion: 'auto', installPackages: true },
            );
        });

        test('Single pyproject.toml: uses pip install -e .', async () => {
            getPipRequirementsFilesStub.resolves([]);
            hasPyprojectTomlStub.resolves(true);
            executeCommandStub.resolves({ path: '/some/.venv/bin/python' });

            const ctx: AutoCreateVenvContext = { hasRequirements: false, hasPyprojectToml: true, uvAvailable: true };
            await autoCreateVenvWithDeps(workspace, ctx);

            sinon.assert.notCalled(showQuickPickWithBackStub);
            assert.deepStrictEqual(executeCommandStub.firstCall.args[1].depInstallArgs, [
                ['pip', 'install', '-e', '.'],
            ]);
        });

        test('Multiple sources: shows quickpick with all items', async () => {
            const reqPath = path.join(workspace.uri.fsPath, 'requirements.txt');
            getPipRequirementsFilesStub.resolves([reqPath]);
            hasPyprojectTomlStub.resolves(true);
            showQuickPickWithBackStub.resolves([
                { label: 'requirements.txt', picked: true },
                { label: 'pyproject.toml', picked: true },
            ]);
            executeCommandStub.resolves(undefined);

            const ctx: AutoCreateVenvContext = { hasRequirements: true, hasPyprojectToml: true, uvAvailable: true };
            await autoCreateVenvWithDeps(workspace, ctx);

            sinon.assert.calledOnce(showQuickPickWithBackStub);
            assert.strictEqual(executeCommandStub.firstCall.args[1].depInstallArgs.length, 2);
        });

        test('User cancels quickpick: skips dep installation', async () => {
            getPipRequirementsFilesStub.resolves([path.join(workspace.uri.fsPath, 'requirements.txt')]);
            hasPyprojectTomlStub.resolves(true);
            showQuickPickWithBackStub.resolves(undefined);
            executeCommandStub.resolves(undefined);

            const ctx: AutoCreateVenvContext = { hasRequirements: true, hasPyprojectToml: true, uvAvailable: true };
            await autoCreateVenvWithDeps(workspace, ctx);

            assert.isFalse(executeCommandStub.firstCall.args[1].installPackages);
        });

        test('uv not available: omits providerId (falls to standard wizard)', async () => {
            getPipRequirementsFilesStub.resolves([path.join(workspace.uri.fsPath, 'requirements.txt')]);
            hasPyprojectTomlStub.resolves(false);
            executeCommandStub.resolves(undefined);

            const ctx: AutoCreateVenvContext = { hasRequirements: true, hasPyprojectToml: false, uvAvailable: false };
            await autoCreateVenvWithDeps(workspace, ctx);

            const options = executeCommandStub.firstCall.args[1];
            assert.isUndefined(options.providerId);
            assert.isUndefined(options.uvPythonVersion);
        });
    });

    suite('uvInstallDeps', () => {
        let progressMock: CreateEnvironmentProgress;

        setup(() => {
            progressMock = { report: sinon.stub() };
        });

        test('Runs uv pip install for each source', async () => {
            const proc = { exitCode: 0 };
            const out = new Observable<Output<string>>((subscriber) => {
                subscriber.next({ source: 'stdout', out: 'ok\n' });
                subscriber.complete();
            });
            execObservableStub.returns({ proc, out, dispose: sinon.stub() });

            await uvInstallDeps(workspace, progressMock, undefined, [
                ['pip', 'install', '-r', 'requirements.txt'],
                ['pip', 'install', '-e', '.'],
            ]);

            sinon.assert.calledTwice(execObservableStub);
        });

        test('Partial failure: continues remaining installs, throws aggregated error', async () => {
            const fail = new Observable<Output<string>>((subscriber) => {
                subscriber.next({ source: 'stdout', out: 'error: not found\n' });
                subscriber.complete();
            });
            const pass = new Observable<Output<string>>((subscriber) => {
                subscriber.next({ source: 'stdout', out: 'ok\n' });
                subscriber.complete();
            });
            execObservableStub.onFirstCall().returns({ proc: { exitCode: 1 }, out: fail, dispose: sinon.stub() });
            execObservableStub.onSecondCall().returns({ proc: { exitCode: 0 }, out: pass, dispose: sinon.stub() });

            try {
                await uvInstallDeps(workspace, progressMock, undefined, [
                    ['pip', 'install', '-r', 'a.txt'],
                    ['pip', 'install', '-r', 'b.txt'],
                ]);
                assert.fail('Should have thrown');
            } catch (err) {
                assert.include(String(err), 'exitCode: 1');
            }
            sinon.assert.calledTwice(execObservableStub);
        });

        test('Empty args: no-ops', async () => {
            await uvInstallDeps(workspace, progressMock, undefined, []);
            sinon.assert.notCalled(execObservableStub);
        });
    });
});
