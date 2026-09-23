/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { Observable } from 'rxjs';
import { Uri } from 'vscode';
import * as rawProcessApis from '../../../../client/common/process/rawProcessApis';
import * as windowApis from '../../../../client/common/vscodeApis/windowApis';
import * as browserApis from '../../../../client/common/vscodeApis/browserApis';
import * as commonUtils from '../../../../client/pythonEnvironments/creation/common/commonUtils';
import * as uvPythonInstaller from '../../../../client/pythonEnvironments/common/environmentManagers/uvPythonInstaller';
import * as pixiModule from '../../../../client/pythonEnvironments/common/environmentManagers/pixi';
import { Output } from '../../../../client/common/process/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../constants';
import {
    autoSyncUvEnv,
    autoInstallPixiEnv,
    showPixiNotInstalledWarning,
} from '../../../../client/pythonEnvironments/creation/provider/autoCreateLockFileEnv';
import { IPythonRuntimeManager } from '../../../../client/positron/manager';
import { Common } from '../../../../client/common/utils/localize';

suite('Auto Create Lock File Env', () => {
    const workspace = {
        uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
        name: 'workspace1',
        index: 0,
    };

    let execObservableStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let launchStub: sinon.SinonStub;
    let selectLanguageRuntimeFromPathStub: sinon.SinonStub;
    let runtimeManager: IPythonRuntimeManager;

    function stubSuccessfulExec(): void {
        const out = new Observable<Output<string>>((subscriber) => {
            subscriber.next({ source: 'stdout', out: 'ok\n' });
            subscriber.complete();
        });
        execObservableStub.returns({ proc: { exitCode: 0 }, out, dispose: sinon.stub() });
    }

    function stubFailingExec(): void {
        const out = new Observable<Output<string>>((subscriber) => {
            subscriber.next({ source: 'stdout', out: 'boom\n' });
            subscriber.complete();
        });
        execObservableStub.returns({ proc: { exitCode: 1 }, out, dispose: sinon.stub() });
    }

    setup(() => {
        execObservableStub = sinon.stub(rawProcessApis, 'execObservable');
        withProgressStub = sinon.stub(windowApis, 'withProgress');
        withProgressStub.callsFake(async (_options, task) => task({ report: sinon.stub() }, undefined));
        showWarningMessageStub = sinon.stub(windowApis, 'showWarningMessage');
        launchStub = sinon.stub(browserApis, 'launch');
        selectLanguageRuntimeFromPathStub = sinon.stub();
        runtimeManager = {
            selectLanguageRuntimeFromPath: selectLanguageRuntimeFromPathStub,
        } as unknown as IPythonRuntimeManager;
    });

    teardown(() => {
        sinon.restore();
    });

    suite('autoSyncUvEnv', () => {
        let ensureUvInstalledStub: sinon.SinonStub;

        setup(() => {
            ensureUvInstalledStub = sinon.stub(uvPythonInstaller, 'ensureUvInstalled');
        });

        test('uv missing and user declines install: does not run uv sync', async () => {
            ensureUvInstalledStub.resolves({ ok: false });

            await autoSyncUvEnv(workspace, runtimeManager);

            sinon.assert.notCalled(execObservableStub);
            sinon.assert.notCalled(selectLanguageRuntimeFromPathStub);
        });

        test('uv installed: runs uv sync in workspace root and selects the resulting venv', async () => {
            ensureUvInstalledStub.resolves({ ok: true });
            stubSuccessfulExec();

            await autoSyncUvEnv(workspace, runtimeManager);

            sinon.assert.calledOnce(execObservableStub);
            const [command, args, options] = execObservableStub.firstCall.args;
            assert.strictEqual(command, 'uv');
            assert.deepStrictEqual(args, ['sync']);
            assert.strictEqual(options.cwd, workspace.uri.fsPath);

            sinon.assert.calledOnceWithExactly(
                selectLanguageRuntimeFromPathStub,
                commonUtils.getVenvExecutable(workspace),
                true,
            );
        });

        test('uv sync fails: does not select a runtime', async () => {
            ensureUvInstalledStub.resolves({ ok: true });
            stubFailingExec();

            await autoSyncUvEnv(workspace, runtimeManager);

            sinon.assert.notCalled(selectLanguageRuntimeFromPathStub);
        });
    });

    suite('showPixiNotInstalledWarning', () => {
        test('clicking Learn More opens the install docs', async () => {
            showWarningMessageStub.resolves(Common.learnMore);

            await showPixiNotInstalledWarning();

            sinon.assert.calledOnce(launchStub);
        });

        test('dismissing does not open the install docs', async () => {
            showWarningMessageStub.resolves(undefined);

            await showPixiNotInstalledWarning();

            sinon.assert.notCalled(launchStub);
        });
    });

    suite('autoInstallPixiEnv', () => {
        test('pixi installed: runs pixi install and selects the default environment interpreter', async () => {
            const pixi = {
                command: 'pixi',
                getPixiInfo: sinon.stub().resolves({
                    environments_info: [{ name: 'default', prefix: '/proj/.pixi/envs/default' }],
                }),
            };
            stubSuccessfulExec();

            await autoInstallPixiEnv(workspace, pixi as unknown as pixiModule.Pixi, runtimeManager);

            sinon.assert.calledOnce(execObservableStub);
            const [command, args, options] = execObservableStub.firstCall.args;
            assert.strictEqual(command, 'pixi');
            assert.deepStrictEqual(args, ['install']);
            assert.strictEqual(options.cwd, workspace.uri.fsPath);

            sinon.assert.calledOnceWithExactly(
                selectLanguageRuntimeFromPathStub,
                path.join('/proj/.pixi/envs/default', 'bin', 'python'),
                true,
            );
        });

        test('pixi install fails: does not select a runtime', async () => {
            const pixi = {
                command: 'pixi',
                getPixiInfo: sinon.stub().resolves({
                    environments_info: [{ name: 'default', prefix: '/proj/.pixi/envs/default' }],
                }),
            };
            stubFailingExec();

            await autoInstallPixiEnv(workspace, pixi as unknown as pixiModule.Pixi, runtimeManager);

            sinon.assert.notCalled(selectLanguageRuntimeFromPathStub);
        });

        test('no default environment found after install: does not select a runtime', async () => {
            const pixi = {
                command: 'pixi',
                getPixiInfo: sinon.stub().resolves({ environments_info: [] }),
            };
            stubSuccessfulExec();

            await autoInstallPixiEnv(workspace, pixi as unknown as pixiModule.Pixi, runtimeManager);

            sinon.assert.notCalled(selectLanguageRuntimeFromPathStub);
        });
    });
});
