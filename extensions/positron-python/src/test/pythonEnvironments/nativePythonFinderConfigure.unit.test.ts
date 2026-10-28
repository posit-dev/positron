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
import * as workspaceScan from '../../client/positron/workspaceScan';
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

    test('configure sends nested project env dirs as workspace directories', async () => {
        const ws = path.join(path.parse(process.cwd()).root, 'positron-nested-ws-does-not-exist');
        const nested = path.join(ws, 'app', '.venv');
        getWorkspaceFolderPathsStub.returns([ws]);
        const scanStub = sinon.stub(workspaceScan, 'scanWorkspace').resolves({
            rootProjectEnvs: [],
            nestedEnvDirs: [nested],
            hasPythonSignals: false,
            pythonVersion: undefined,
            isEmpty: false,
        });

        const finder = createNativePythonFinder();
        try {
            // Drain the first refresh before disposing: a configure still queued when the
            // finder is disposed would respawn PET and keep the test process alive.
            // The refresh scans for nested envs once. The first refresh reuses the scan
            // the interpreter ranking shares at startup instead of reading the folder again.
            await refreshWithin(finder, 60_000);
            assert.deepEqual(
                scanStub.getCalls().map((call) => call.args),
                [[ws, false]],
            );

            // A resolve-path configure reuses the list the refresh found instead of
            // rescanning. Read the options directly: `lastConfiguration` is reset whenever
            // PET shuts down, which this suite's zero idle timeout makes likely.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resolveOptions = await (finder as any).configurationOptions(false);
            assert.deepEqual(resolveOptions.workspaceDirectories, [ws, nested]);
            assert.strictEqual(scanStub.callCount, 1);

            // Once the folder is closed, its nested envs are no longer sent.
            getWorkspaceFolderPathsStub.returns([]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const closedOptions = await (finder as any).configurationOptions(false);
            assert.deepEqual(closedOptions.workspaceDirectories, []);
        } finally {
            finder.dispose();
        }
    });
});
