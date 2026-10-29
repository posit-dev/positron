/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import * as vscode from 'vscode';
import { IWorkspaceService } from '../../client/common/application/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { pythonRuntimeDiscoverer } from '../../client/positron/discoverer';
import * as interpreterRanking from '../../client/positron/interpreterRanking';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
import * as runtime from '../../client/positron/runtime';
import { createTypeMoq } from '../mocks/helper';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { Architecture } from '../../client/common/utils/platform';

function makeInterpreter(envType: EnvironmentType, version: string): PythonEnvironment {
    const [major, minor, patch] = version.split('.').map(Number);
    return {
        id: `${envType}-${version}`,
        path: `/envs/${envType}-${version}/bin/python`,
        envType,
        architecture: Architecture.x64,
        sysPrefix: `/envs/${envType}-${version}`,
        version: { major, minor, patch, raw: version, build: [], prerelease: [] },
    };
}

suite('pythonRuntimeDiscoverer', () => {
    teardown(() => {
        sinon.restore();
    });

    test('registers every interpreter as Explicit, in discovery order', async () => {
        const system = makeInterpreter(EnvironmentType.System, '3.13.1');
        const venv = makeInterpreter(EnvironmentType.Venv, '3.12.7');
        const interpreterService = createTypeMoq<IInterpreterService>();
        interpreterService.setup((s) => s.triggerRefresh(TypeMoq.It.isAny())).returns(() => Promise.resolve());
        interpreterService.setup((s) => s.getInterpreters(TypeMoq.It.isAny())).returns(() => [system, venv]);
        const serviceContainer = createTypeMoq<IServiceContainer>();
        serviceContainer.setup((c) => c.get(IInterpreterService)).returns(() => interpreterService.object);
        const workspaceService = createTypeMoq<IWorkspaceService>();
        workspaceService.setup((w) => w.workspaceFolders).returns(() => undefined);
        serviceContainer.setup((c) => c.get(IWorkspaceService)).returns(() => workspaceService.object);
        sinon.stub(interpreterRanking, 'buildRankingContext').resolves({} as interpreterRanking.RankingContext);

        sinon.stub(interpreterSettings, 'shouldIncludeInterpreter').returns(true);
        const create = sinon
            .stub(runtime, 'createPythonRuntimeMetadata')
            .callsFake(async (interpreter) => ({ runtimePath: interpreter.path } as positron.LanguageRuntimeMetadata));

        for await (const _ of pythonRuntimeDiscoverer(serviceContainer.object)) {
            // drain
        }

        // No sorting and no startup behavior passed, so every runtime gets the `Explicit`
        // default. Core uses the remembered recommendation, and the picker sorts by
        // `runtimeSourceOrder`, so yield order decides nothing.
        assert.deepEqual(
            create.getCalls().map((call) => [call.args[0].path, call.args[2]]),
            [
                [system.path, undefined],
                [venv.path, undefined],
            ],
        );
    });

    test('groups each interpreter with the workspace folder that holds it', async () => {
        const first = { uri: vscode.Uri.file('/work/first'), name: 'first', index: 0 };
        const second = { uri: vscode.Uri.file('/work/second'), name: 'second', index: 1 };
        const inSecond = { ...makeInterpreter(EnvironmentType.Venv, '3.13.5'), path: '/work/second/.venv/bin/python' };
        const global = makeInterpreter(EnvironmentType.System, '3.12.7');
        const interpreterService = createTypeMoq<IInterpreterService>();
        interpreterService.setup((s) => s.triggerRefresh(TypeMoq.It.isAny())).returns(() => Promise.resolve());
        interpreterService.setup((s) => s.getInterpreters(TypeMoq.It.isAny())).returns(() => [inSecond, global]);
        const serviceContainer = createTypeMoq<IServiceContainer>();
        serviceContainer.setup((c) => c.get(IInterpreterService)).returns(() => interpreterService.object);
        const workspaceService = createTypeMoq<IWorkspaceService>();
        workspaceService.setup((w) => w.workspaceFolders).returns(() => [first, second]);
        workspaceService
            .setup((w) => w.getWorkspaceFolder(TypeMoq.It.isAny()))
            .returns((uri: vscode.Uri) =>
                [first, second].find((folder) => uri.fsPath.startsWith(folder.uri.fsPath + path.sep)),
            );
        serviceContainer.setup((c) => c.get(IWorkspaceService)).returns(() => workspaceService.object);
        sinon
            .stub(interpreterRanking, 'buildRankingContext')
            .callsFake(async (_, uri) => ({ workspacePath: uri?.fsPath } as interpreterRanking.RankingContext));

        sinon.stub(interpreterSettings, 'shouldIncludeInterpreter').returns(true);
        const create = sinon
            .stub(runtime, 'createPythonRuntimeMetadata')
            .callsFake(async (interpreter) => ({ runtimePath: interpreter.path } as positron.LanguageRuntimeMetadata));

        for await (const _ of pythonRuntimeDiscoverer(serviceContainer.object)) {
            // drain
        }

        // An interpreter outside every folder falls back to the first folder.
        assert.deepEqual(
            create.getCalls().map((call) => [call.args[0].path, call.args[3]?.pickerContext?.workspacePath]),
            [
                [inSecond.path, second.uri.fsPath],
                [global.path, first.uri.fsPath],
            ],
        );
    });
});
