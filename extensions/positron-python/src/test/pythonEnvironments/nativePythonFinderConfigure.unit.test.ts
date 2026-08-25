/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A refresh must always settle. The `configure` request runs before `refresh` is
 * sent, so anything that throws while the configuration is assembled used to
 * leave the refresh awaiting a promise that could never resolve: discovery hung
 * for the lifetime of the window and no interpreter was ever registered.
 */

import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { WorkspaceConfiguration } from 'vscode';
import {
    createNativePythonFinder,
    NativeEnvInfo,
    NativePythonFinder,
} from '../../client/pythonEnvironments/base/locators/common/nativePythonFinder';
import * as windowsApis from '../../client/common/vscodeApis/windowApis';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import { MockOutputChannel } from '../mockClasses';

suite('Native Python Finder - configuration failures must not hang discovery', () => {
    let configMock: typemoq.IMock<WorkspaceConfiguration>;
    let getWorkspaceFolderPathsStub: sinon.SinonStub;
    let override: string[];

    setup(() => {
        sinon.stub(windowsApis, 'createLogOutputChannel').returns(new MockOutputChannel('locator'));
        getWorkspaceFolderPathsStub = sinon.stub(workspaceApis, 'getWorkspaceFolderPaths').returns([]);

        override = [];

        configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get<string>('venvPath')).returns(() => undefined);
        configMock.setup((c) => c.get<string[]>('venvFolders')).returns(() => []);
        configMock.setup((c) => c.get<string>('condaPath')).returns(() => '');
        configMock.setup((c) => c.get<string>('poetryPath')).returns(() => '');
        configMock.setup((c) => c.get('locatorIdleTimeout', 180)).returns(() => 0);
        configMock.setup((c) => c.get<string[]>('interpreters.override')).returns(() => override);
        configMock.setup((c) => c.get<string[]>('interpreters.include')).returns(() => []);

        const interpretersConfigMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        interpretersConfigMock.setup((c) => c.get<string>('startupBehavior')).returns(() => undefined);

        sinon
            .stub(workspaceApis, 'getConfiguration')
            .callsFake((section?: string) =>
                section === 'interpreters' ? interpretersConfigMock.object : configMock.object,
            );
    });

    teardown(() => {
        sinon.restore();
    });

    async function drainRefresh(finder: NativePythonFinder): Promise<(NativeEnvInfo | unknown)[]> {
        const envs = [];
        for await (const env of finder.refresh()) {
            envs.push(env);
        }
        return envs;
    }

    /**
     * Fails fast when a refresh hangs. Without this the test would sit until the
     * suite timeout, which reports a timeout rather than the behavior at fault.
     */
    async function refreshWithin(finder: NativePythonFinder, timeoutMs: number): Promise<(NativeEnvInfo | unknown)[]> {
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                drainRefresh(finder),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`refresh did not finish within ${timeoutMs}ms`)),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    test('refresh finishes when an interpreter setting names a path that does not exist', async () => {
        override = [path.join(path.parse(process.cwd()).root, 'asdalsk-positron-does-not-exist')];
        const finder = createNativePythonFinder();
        try {
            assert.isNotEmpty(await refreshWithin(finder, 60_000));
        } finally {
            finder.dispose();
        }
    });

    test('refresh finishes when assembling the configuration throws', async () => {
        getWorkspaceFolderPathsStub.throws(new Error('workspace folders unavailable'));
        const finder = createNativePythonFinder();
        try {
            // The refresh cannot discover anything without a configured server, but
            // it must end rather than hang so a later refresh can succeed.
            assert.isEmpty(await refreshWithin(finder, 60_000));
            // The refresh request must not go out against a stale configuration; if
            // it did, its success would clear the error and hide the failure.
            assert.match(finder.lastDiscoveryError ?? '', /workspace folders unavailable/);
        } finally {
            finder.dispose();
        }
    });
});
