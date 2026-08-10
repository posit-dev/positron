/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lifecycle tests for the PET server owned by `NativePythonFinderImpl`: idle
 * shutdown, transparent respawn after a crash, and the startup gate when Python
 * interpreter startup is disabled. See
 * https://github.com/posit-dev/positron/issues/15004.
 *
 */

import { assert } from 'chai';
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

suite('Native Python Finder - server lifecycle (#15004)', () => {
    let getConfigurationStub: sinon.SinonStub;
    let configMock: typemoq.IMock<WorkspaceConfiguration>;
    let interpretersConfigMock: typemoq.IMock<WorkspaceConfiguration>;
    let idleTimeoutSeconds: number;
    let startupBehavior: string | undefined;

    setup(() => {
        sinon.stub(windowsApis, 'createLogOutputChannel').returns(new MockOutputChannel('locator'));
        sinon.stub(workspaceApis, 'getWorkspaceFolderPaths').returns([]);

        idleTimeoutSeconds = 0;
        startupBehavior = undefined;

        configMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        configMock.setup((c) => c.get<string>('venvPath')).returns(() => undefined);
        configMock.setup((c) => c.get<string[]>('venvFolders')).returns(() => []);
        configMock.setup((c) => c.get<string>('condaPath')).returns(() => '');
        configMock.setup((c) => c.get<string>('poetryPath')).returns(() => '');
        configMock.setup((c) => c.get('locatorIdleTimeout', 180)).returns(() => idleTimeoutSeconds);

        interpretersConfigMock = typemoq.Mock.ofType<WorkspaceConfiguration>();
        interpretersConfigMock.setup((c) => c.get<string>('startupBehavior')).returns(() => startupBehavior);

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string) =>
            section === 'interpreters' ? interpretersConfigMock.object : configMock.object,
        );
    });

    teardown(() => {
        sinon.restore();
    });

    async function waitFor(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
        const start = Date.now();
        while (!condition()) {
            if (Date.now() - start > timeoutMs) {
                throw new Error(`Timed out waiting for ${what}`);
            }
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    async function drainRefresh(finder: NativePythonFinder): Promise<(NativeEnvInfo | unknown)[]> {
        const envs = [];
        for await (const env of finder.refresh()) {
            envs.push(env);
        }
        return envs;
    }

    test('requests after the server process dies respawn it instead of hanging', async () => {
        const finder = createNativePythonFinder();
        try {
            assert.isNotEmpty(await drainRefresh(finder));
            const pid = finder.serverPid;
            assert.isDefined(pid, 'server should be running after a refresh');

            process.kill(pid!, 'SIGKILL');
            await waitFor(() => finder.serverPid === undefined, 10_000, 'server exit to be observed');

            assert.isNotEmpty(await drainRefresh(finder), 'refresh after crash should succeed');
            assert.isDefined(finder.serverPid, 'server should have respawned');
        } finally {
            finder.dispose();
        }
    });

    test('server shuts down after the idle timeout and respawns on the next request', async () => {
        idleTimeoutSeconds = 1;
        const finder = createNativePythonFinder();
        try {
            assert.isNotEmpty(await drainRefresh(finder));
            assert.isDefined(finder.serverPid, 'server should be running right after a refresh');

            await waitFor(() => finder.serverPid === undefined, 10_000, 'idle shutdown');

            assert.isNotEmpty(await drainRefresh(finder), 'refresh after idle shutdown should succeed');
            assert.isDefined(finder.serverPid, 'server should have respawned');
        } finally {
            finder.dispose();
        }
    });

    test('does not spawn the server at construction when Python startup is disabled', async () => {
        startupBehavior = 'disabled';
        const finder = createNativePythonFinder();
        try {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            assert.isUndefined(finder.serverPid, 'no server process expected while disabled');

            // An explicit request still works: it spawns the server lazily.
            assert.isNotEmpty(await drainRefresh(finder));
            assert.isDefined(finder.serverPid, 'explicit refresh should spawn the server');
        } finally {
            finder.dispose();
        }
    });

    test('an in-flight refresh is not interrupted by an idle shutdown', async () => {
        startupBehavior = 'disabled';

        // Reference run with shutdown disabled, so nothing can cut it short.
        idleTimeoutSeconds = 0;
        const reference = createNativePythonFinder();
        let expected: number;
        try {
            expected = (await drainRefresh(reference)).length;
        } finally {
            reference.dispose();
        }
        assert.isAbove(expected, 0, 'reference refresh should discover environments');

        // The same refresh, but with an idle timeout far shorter than a refresh
        // takes. Unless the refresh keeps a request in flight, the timer fires
        // partway through and kills the server. Asserting the result is merely
        // non-empty would not catch that: PET emits most environments early, so
        // a truncated refresh still returns some. Compare the full count.
        idleTimeoutSeconds = 0.005;
        const finder = createNativePythonFinder();
        try {
            assert.strictEqual(
                (await drainRefresh(finder)).length,
                expected,
                'refresh was truncated by an idle shutdown while it was still running',
            );
        } finally {
            finder.dispose();
        }
    });

    test('picks up a changed idle timeout without rebuilding the finder', async () => {
        idleTimeoutSeconds = 0;
        const finder = createNativePythonFinder();
        try {
            assert.isNotEmpty(await drainRefresh(finder));
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            assert.isDefined(finder.serverPid, 'server should still be up while the timeout is 0');

            // Change the setting on a live finder; the next request re-arms the
            // timer and must read the new value rather than a cached one.
            idleTimeoutSeconds = 1;
            assert.isNotEmpty(await drainRefresh(finder));

            await waitFor(() => finder.serverPid === undefined, 10_000, 'idle shutdown after the timeout changed');
        } finally {
            finder.dispose();
        }
    });

    test('idle timeout of 0 keeps the server running', async () => {
        idleTimeoutSeconds = 0;
        const finder = createNativePythonFinder();
        try {
            assert.isNotEmpty(await drainRefresh(finder));
            await new Promise((resolve) => setTimeout(resolve, 2_500));
            assert.isDefined(finder.serverPid, 'server should still be running with timeout 0');
        } finally {
            finder.dispose();
        }
    });
});
