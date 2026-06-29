/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { anything, when, reset } from 'ts-mockito';
import { MultiStepAction } from '../../../../client/common/vscodeApis/windowApis';
import * as fileUtils from '../../../../client/pythonEnvironments/common/externalDependencies';
import * as logging from '../../../../client/logging';
import * as uv from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as workspaceApis from '../../../../client/common/vscodeApis/workspaceApis';
import * as uvCreationProvider from '../../../../client/pythonEnvironments/creation/provider/uvCreationProvider';
import * as commonCreationUtils from '../../../../client/pythonEnvironments/creation/common/commonUtils';
import * as venvUtils from '../../../../client/pythonEnvironments/creation/provider/venvUtils';
import * as apiInternal from '../../../../client/envExt/api.internal';
import { getAvailablePythonVersions } from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import { installPythonViaUv } from '../../../../client/pythonEnvironments/common/environmentManagers/uvPythonInstaller';
import { mockedVSCodeNamespaces } from '../../../vscode-mock';
import { InterpreterQuickPickList } from '../../../../client/common/utils/localize';

// Helper to get expected global venv path
function getExpectedGlobalVenvPython(): string {
    const homeDir = os.homedir();
    const venvPath = path.join(homeDir, '.venv');
    return process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'python.exe')
        : path.join(venvPath, 'bin', 'python');
}

suite('UV Python Installer Tests', () => {
    let execStub: sinon.SinonStub;
    let traceErrorStub: sinon.SinonStub;

    setup(() => {
        execStub = sinon.stub(fileUtils, 'exec');
        traceErrorStub = sinon.stub(logging, 'traceError');
        sinon.stub(logging, 'traceVerbose');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('getAvailablePythonVersions Tests', () => {
        test('Returns empty array when uv is not installed', async () => {
            // When uv python dir fails, UvUtils.getUvUtils() returns undefined
            execStub.rejects(new Error('Command failed'));

            const result = await getAvailablePythonVersions();

            // Should return empty array (UvUtils returns undefined, so we short-circuit)
            assert.deepStrictEqual(result, []);
        });

        test('Returns empty array when uv python list returns empty output', async () => {
            execStub.resolves({ stdout: '' });

            const result = await getAvailablePythonVersions();

            assert.deepStrictEqual(result, []);
        });

        test('Parses single stable version correctly (returns MAJOR.MINOR)', async () => {
            execStub.resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].version, '3.13');
            assert.strictEqual(result[0].isInstalled, false);
            assert.strictEqual(result[0].path, undefined);
            assert.strictEqual(result[0].identifier, 'cpython-3.13.1-macos-aarch64-none');
        });

        test('Parses installed version with path correctly', async () => {
            execStub.resolves({
                stdout: 'cpython-3.12.8-macos-aarch64-none    /usr/local/bin/python3.12',
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].version, '3.12');
            assert.strictEqual(result[0].isInstalled, true);
            assert.strictEqual(result[0].path, '/usr/local/bin/python3.12');
        });

        test('Parses installed version with symlink arrow correctly', async () => {
            execStub.resolves({
                stdout: 'cpython-3.13.7-macos-aarch64-none     /usr/local/bin/python3.13 -> python3.13.real',
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].version, '3.13');
            assert.strictEqual(result[0].isInstalled, true);
            assert.strictEqual(result[0].path, '/usr/local/bin/python3.13');
        });

        test('Filters out pre-release versions', async () => {
            execStub.resolves({
                stdout: [
                    'cpython-3.14.0a5-macos-aarch64-none    <download available>',
                    'cpython-3.13.1-macos-aarch64-none    <download available>',
                    'cpython-3.14.0b2-macos-aarch64-none    <download available>',
                    'cpython-3.12.0rc1-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].version, '3.13');
        });

        test('Deduplicates to one entry per minor version', async () => {
            execStub.resolves({
                stdout: [
                    'cpython-3.13.2-macos-aarch64-none    <download available>',
                    'cpython-3.13.1-macos-aarch64-none    /usr/local/bin/python3.13',
                    'cpython-3.13.0-macos-aarch64-none    <download available>',
                    'cpython-3.12.8-macos-aarch64-none    <download available>',
                    'cpython-3.12.7-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            // Should only have 3.13 and 3.12 (one entry per minor version). A newer
            // "<download available>" patch is listed before the installed older patch, so
            // 3.13 must still be reported as installed with the installed patch's path.
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].version, '3.13');
            assert.strictEqual(result[0].isInstalled, true);
            assert.strictEqual(result[0].path, '/usr/local/bin/python3.13');
            assert.strictEqual(result[1].version, '3.12');
            assert.strictEqual(result[1].isInstalled, false);
        });

        test('Sorts versions in descending order', async () => {
            execStub.resolves({
                stdout: [
                    'cpython-3.10.5-macos-aarch64-none    <download available>',
                    'cpython-3.13.1-macos-aarch64-none    <download available>',
                    'cpython-3.11.8-macos-aarch64-none    <download available>',
                    'cpython-3.12.4-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 4);
            assert.strictEqual(result[0].version, '3.13');
            assert.strictEqual(result[1].version, '3.12');
            assert.strictEqual(result[2].version, '3.11');
            assert.strictEqual(result[3].version, '3.10');
        });

        test('Skips non-cpython entries', async () => {
            execStub.resolves({
                stdout: [
                    'pypy-3.10.14-macos-aarch64-none    <download available>',
                    'cpython-3.13.1-macos-aarch64-none    <download available>',
                    'graalpy-24.1.1-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].version, '3.13');
        });

        test('Handles Windows paths correctly', async () => {
            execStub.resolves({
                stdout: 'cpython-3.12.5-windows-x86_64-none    C:\\Users\\test\\AppData\\Local\\uv\\python\\python.exe',
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].version, '3.12');
            assert.strictEqual(result[0].isInstalled, true);
            assert.strictEqual(result[0].path, 'C:\\Users\\test\\AppData\\Local\\uv\\python\\python.exe');
        });

        test('Handles mixed installed and available versions', async () => {
            execStub.resolves({
                stdout: [
                    'cpython-3.13.2-macos-aarch64-none    <download available>',
                    'cpython-3.12.8-macos-aarch64-none    /home/user/.local/share/uv/python/python3.12',
                    'cpython-3.11.9-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 3);

            const v313 = result.find((v) => v.version === '3.13');
            const v312 = result.find((v) => v.version === '3.12');
            const v311 = result.find((v) => v.version === '3.11');

            assert.ok(v313);
            assert.strictEqual(v313.isInstalled, false);

            assert.ok(v312);
            assert.strictEqual(v312.isInstalled, true);
            assert.strictEqual(v312.path, '/home/user/.local/share/uv/python/python3.12');

            assert.ok(v311);
            assert.strictEqual(v311.isInstalled, false);
        });

        test('Requests only uv-managed Pythons (passes --managed-python)', async () => {
            // System Pythons (e.g. /usr/bin/python3) must not be reported as installed in the
            // "Install Python via uv" flow, so the listing is restricted to uv-managed Pythons.
            execStub.resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });

            await getAvailablePythonVersions();

            const listCall = execStub
                .getCalls()
                .find((call) => Array.isArray(call.args[1]) && (call.args[1] as string[]).includes('list'));
            assert.ok(listCall, 'Expected uv python list to be invoked');
            assert.ok(
                (listCall.args[1] as string[]).includes('--managed-python'),
                'Expected uv python list to be called with --managed-python',
            );
        });

        test('Reports a minor version as installed when a newer patch is download-available', async () => {
            // Mirrors real `uv python list` output: newest patches are listed first as
            // "<download available>", freethreaded variants are interleaved, and the installed
            // patch (further down) uses a "actual -> target" symlink path.
            execStub.resolves({
                stdout: [
                    'cpython-3.14.6-macos-aarch64-none                 <download available>',
                    'cpython-3.14.6+freethreaded-macos-aarch64-none    <download available>',
                    'cpython-3.14.5-macos-aarch64-none                 /Users/test/.local/bin/python3.14 -> /Users/test/.local/share/uv/python/cpython-3.14-macos-aarch64-none/bin/python3.14',
                    'cpython-3.13.14-macos-aarch64-none                <download available>',
                    'cpython-3.13.13-macos-aarch64-none                /Users/test/.local/bin/python3.13 -> /Users/test/.local/share/uv/python/cpython-3.13.13-macos-aarch64-none/bin/python3.13',
                    'cpython-3.12.13-macos-aarch64-none                /Users/test/.local/bin/python3.12 -> /Users/test/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.deepStrictEqual(
                result.map((v) => ({ version: v.version, isInstalled: v.isInstalled, path: v.path })),
                [
                    { version: '3.14', isInstalled: true, path: '/Users/test/.local/bin/python3.14' },
                    { version: '3.13', isInstalled: true, path: '/Users/test/.local/bin/python3.13' },
                    { version: '3.12', isInstalled: true, path: '/Users/test/.local/bin/python3.12' },
                ],
            );
        });

        test('Handles empty lines and whitespace in output', async () => {
            execStub.resolves({
                stdout: [
                    '',
                    '  cpython-3.13.1-macos-aarch64-none    <download available>  ',
                    '',
                    '  cpython-3.12.8-macos-aarch64-none    /usr/local/bin/python3.12  ',
                    '',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].version, '3.13');
            assert.strictEqual(result[1].version, '3.12');
        });

        test('Skips lines that do not match expected format', async () => {
            execStub.resolves({
                stdout: [
                    'cpython-3.13.1-macos-aarch64-none    <download available>',
                    'some random text that should be ignored',
                    'cpython-invalid-format    <download available>',
                    'cpython-3.12.8-macos-aarch64-none    /usr/local/bin/python3.12',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].version, '3.13');
            assert.strictEqual(result[1].version, '3.12');
        });

        test('Filters out versions below MINIMUM_PYTHON_VERSION (3.9)', async () => {
            execStub.resolves({
                stdout: [
                    'cpython-3.13.1-macos-aarch64-none    <download available>',
                    'cpython-3.8.20-macos-aarch64-none    <download available>',
                    'cpython-3.7.17-macos-aarch64-none    <download available>',
                    'cpython-2.7.18-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].version, '3.13');
        });

        test('Filters out versions at or above MAXIMUM_PYTHON_VERSION_EXCLUSIVE (3.15)', async () => {
            execStub.resolves({
                stdout: [
                    'cpython-3.16.0-macos-aarch64-none    <download available>',
                    'cpython-3.15.0-macos-aarch64-none    <download available>',
                    'cpython-3.14.1-macos-aarch64-none    <download available>',
                    'cpython-3.13.1-macos-aarch64-none    <download available>',
                ].join('\n'),
            });

            const result = await getAvailablePythonVersions();

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].version, '3.14');
            assert.strictEqual(result[1].version, '3.13');
        });
    });

    suite('installPythonViaUv Tests', () => {
        let isUvInstalledStub: sinon.SinonStub;
        let getWorkspaceFoldersStub: sinon.SinonStub;
        let createUvVenvStub: sinon.SinonStub;
        let getAvailablePythonVersionsStub: sinon.SinonStub;
        let hasVenvStub: sinon.SinonStub;
        let pickExistingVenvActionStub: sinon.SinonStub;
        let deleteEnvironmentStub: sinon.SinonStub;
        let getVenvExecutableStub: sinon.SinonStub;

        const mockProgress = {
            report: sinon.stub(),
        };

        // Track quick pick call count for sequencing
        let quickPickCallCount: number;
        let quickPickResponses: (any | undefined)[];

        setup(() => {
            isUvInstalledStub = sinon.stub(uv, 'isUvInstalled');
            getWorkspaceFoldersStub = sinon.stub(workspaceApis, 'getWorkspaceFolders');
            createUvVenvStub = sinon.stub(uvCreationProvider, 'createUvVenv');
            // Stub the existing-venv handling helpers. Defaults: no existing venv,
            // so tests fall through to the create path unless they opt in.
            hasVenvStub = sinon.stub(commonCreationUtils, 'hasVenv').resolves(false);
            getVenvExecutableStub = sinon.stub(commonCreationUtils, 'getVenvExecutable');
            pickExistingVenvActionStub = sinon.stub(venvUtils, 'pickExistingVenvAction');
            deleteEnvironmentStub = sinon.stub(venvUtils, 'deleteEnvironment').resolves(true);
            // Stub getAvailablePythonVersions from uv module
            getAvailablePythonVersionsStub = sinon.stub(uv, 'getAvailablePythonVersions');
            // Stub refreshEnvironments to avoid actual environment refresh
            sinon.stub(apiInternal, 'refreshEnvironments').resolves();
            sinon.stub(logging, 'traceInfo');

            quickPickCallCount = 0;
            quickPickResponses = [];

            // Configure vscode.window mock using ts-mockito
            reset(mockedVSCodeNamespaces.window!);

            // withProgress executes the callback immediately
            when(mockedVSCodeNamespaces.window!.withProgress(anything(), anything())).thenCall(
                async (_options: any, task: any) => {
                    return task(mockProgress as any, {} as any);
                },
            );

            // showQuickPick returns from quickPickResponses array in sequence
            when(mockedVSCodeNamespaces.window!.showQuickPick(anything(), anything())).thenCall(async () => {
                const response = quickPickResponses[quickPickCallCount];
                quickPickCallCount++;
                return response;
            });

            when(mockedVSCodeNamespaces.window!.showErrorMessage(anything())).thenResolve(undefined);
            // Default: user confirms uv installation when prompted (4 args: message, options, install button, learn more)
            when(
                mockedVSCodeNamespaces.window!.showInformationMessage(anything(), anything(), anything(), anything()),
            ).thenResolve(InterpreterQuickPickList.UvInstall.confirmUvInstallYes as any);
            // Default: user accepts venv creation when prompted (3 args: message, yes button, no button)
            when(mockedVSCodeNamespaces.window!.showInformationMessage(anything(), anything(), anything())).thenResolve(
                InterpreterQuickPickList.UvInstall.yesRecommended as any,
            );
            when(mockedVSCodeNamespaces.window!.showInformationMessage(anything())).thenResolve(undefined);
            when(mockedVSCodeNamespaces.window!.showWarningMessage(anything())).thenResolve(undefined);

            mockProgress.report.reset();
        });

        test('Returns cancelled when user cancels version selection', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User cancels quick pick
            quickPickResponses = [undefined];

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Cancelled');
        });

        test('Exits silently when uv installation fails or is declined', async () => {
            // uv not installed initially
            isUvInstalledStub.resolves(false);
            // uv install command fails
            execStub.rejects(new Error('Installation failed'));

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            // Should not have an error message - exit silently
            assert.strictEqual(result.error, undefined);
        });

        test('Continues after uv installation even if PATH not updated in current process', async () => {
            // uv not installed initially
            isUvInstalledStub.onFirstCall().resolves(false);
            // After install, uv is located (e.g. via its known install location)
            isUvInstalledStub.resolves(true);
            // uv install succeeds
            execStub.onCall(0).resolves({ stdout: '' }); // uv install
            // After install, getAvailablePythonVersions returns versions
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onCall(1).resolves({ stdout: '' });
            // uv python find returns path
            execStub.onCall(2).resolves({ stdout: '/usr/local/bin/python3.13' });
            // uv venv creation succeeds (for global venv)
            execStub.onCall(3).resolves({ stdout: '' });
            // No workspace
            getWorkspaceFoldersStub.returns(undefined);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
        });

        test('Returns actionable error when uv cannot be found after installation', async () => {
            // uv not installed initially, install command succeeds...
            isUvInstalledStub.onFirstCall().resolves(false);
            execStub.resolves({ stdout: '' });
            // ...but uv still cannot be located afterwards (e.g. installed outside any
            // known location and not on the current process PATH).
            isUvInstalledStub.resolves(false);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, InterpreterQuickPickList.UvInstall.uvNotFoundAfterInstall);
        });

        test('Returns error when Python installation fails', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions via stub
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install fails
            execStub.onFirstCall().rejects(new Error('Install failed'));

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('3.13'));
        });

        test('Returns error when no Python versions available', async () => {
            isUvInstalledStub.resolves(true);
            // No versions available
            getAvailablePythonVersionsStub.resolves([]);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            // Error message shown via vscode.window.showErrorMessage
        });

        test('Creates global venv when no workspace is open', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions via stub
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onFirstCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // uv venv creation succeeds (for global venv)
            execStub.onThirdCall().resolves({ stdout: '' });
            // No workspace open
            getWorkspaceFoldersStub.returns(undefined);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            // Should return the global venv path
            assert.strictEqual(result.pythonPath, getExpectedGlobalVenvPython());
        });

        test('Succeeds with venv creation when user accepts', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions via stub
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version (venv creation uses showInformationMessage - default returns yes)
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onFirstCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // Workspace is open
            const mockWorkspace = { uri: { fsPath: '/test/workspace' }, name: 'test', index: 0 };
            getWorkspaceFoldersStub.returns([mockWorkspace]);
            // Venv creation succeeds
            createUvVenvStub.resolves('/test/workspace/.venv/bin/python');

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, '/test/workspace/.venv/bin/python');
            assert.ok(createUvVenvStub.calledOnce);
        });

        test('Succeeds without venv when user declines', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions via stub
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version (venv creation uses showInformationMessage - user dismisses)
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // Override: user dismisses the venv creation notification
            when(mockedVSCodeNamespaces.window!.showInformationMessage(anything(), anything(), anything())).thenResolve(
                undefined,
            );
            // uv python install succeeds
            execStub.onFirstCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // Workspace is open
            const mockWorkspace = { uri: { fsPath: '/test/workspace' }, name: 'test', index: 0 };
            getWorkspaceFoldersStub.returns([mockWorkspace]);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
            assert.ok(!createUvVenvStub.called);
        });

        test('Falls back to Python path when venv creation fails', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions via stub
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version (venv creation uses showInformationMessage - default returns yes)
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onFirstCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // Workspace is open
            const mockWorkspace = { uri: { fsPath: '/test/workspace' }, name: 'test', index: 0 };
            getWorkspaceFoldersStub.returns([mockWorkspace]);
            // Venv creation fails
            createUvVenvStub.resolves(undefined);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
        });

        suite('Existing venv handling', () => {
            const mockWorkspace = { uri: { fsPath: '/test/workspace' }, name: 'test', index: 0 };

            // Sets up a successful install where a workspace is open and the user
            // accepts venv creation, leaving the existing-venv branch to decide.
            function arrangeWorkspaceInstall(): void {
                isUvInstalledStub.resolves(true);
                getAvailablePythonVersionsStub.resolves([
                    { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
                ]);
                // version select only - venv creation uses showInformationMessage (default: yes)
                quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
                execStub.onFirstCall().resolves({ stdout: '' }); // uv python install
                execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' }); // uv python find
                getWorkspaceFoldersStub.returns([mockWorkspace]);
            }

            test('Recreate: delete fails → succeeds with base Python and reports failure via progress', async () => {
                arrangeWorkspaceInstall();
                hasVenvStub.resolves(true);
                pickExistingVenvActionStub.resolves(venvUtils.ExistingVenvAction.Recreate);
                deleteEnvironmentStub.resolves(false);

                const result = await installPythonViaUv();

                // Python was installed - the delete failure must not discard it
                assert.strictEqual(result.success, true);
                assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
                assert.ok(!createUvVenvStub.called, 'should not attempt venv after failed delete');
                assert.ok(
                    mockProgress.report.calledWithMatch({
                        message: InterpreterQuickPickList.UvInstall.venvCreationFailed,
                    }),
                    'should report venv creation failure via progress',
                );
            });

            test('User cancels existing-venv prompt → succeeds with base Python', async () => {
                arrangeWorkspaceInstall();
                hasVenvStub.resolves(true);
                pickExistingVenvActionStub.callsFake(async () => {
                    throw MultiStepAction.Cancel;
                });

                const result = await installPythonViaUv();

                assert.strictEqual(result.success, true);
                assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
                assert.ok(!deleteEnvironmentStub.called);
                assert.ok(!createUvVenvStub.called);
            });

            test('User backs out of existing-venv prompt → succeeds with base Python', async () => {
                arrangeWorkspaceInstall();
                hasVenvStub.resolves(true);
                pickExistingVenvActionStub.callsFake(async () => {
                    throw MultiStepAction.Back;
                });

                const result = await installPythonViaUv();

                assert.strictEqual(result.success, true);
                assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
                assert.ok(!deleteEnvironmentStub.called);
                assert.ok(!createUvVenvStub.called);
            });

            test('Global use existing: returns existing ~/.venv Python without creating', async () => {
                isUvInstalledStub.resolves(true);
                getAvailablePythonVersionsStub.resolves([
                    { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
                ]);
                quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
                execStub.onFirstCall().resolves({ stdout: '' }); // uv python install
                execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' }); // uv python find
                getWorkspaceFoldersStub.returns(undefined);
                hasVenvStub.resolves(true);
                pickExistingVenvActionStub.resolves(venvUtils.ExistingVenvAction.UseExisting);
                getVenvExecutableStub.returns(getExpectedGlobalVenvPython());

                const result = await installPythonViaUv();

                assert.strictEqual(result.success, true);
                assert.strictEqual(result.pythonPath, getExpectedGlobalVenvPython());
                assert.ok(!deleteEnvironmentStub.called);
                // Only install + find — no venv creation exec call
                assert.strictEqual(execStub.callCount, 2);
            });

            test('Recreate: detects existing venv, prompts, then deletes before recreating', async () => {
                arrangeWorkspaceInstall();
                hasVenvStub.resolves(true);
                pickExistingVenvActionStub.resolves(venvUtils.ExistingVenvAction.Recreate);
                createUvVenvStub.resolves('/test/workspace/.venv/bin/python');

                const result = await installPythonViaUv();

                assert.strictEqual(result.success, true);
                assert.strictEqual(result.pythonPath, '/test/workspace/.venv/bin/python');
                // Intended sequence: detect existing -> prompt action -> delete -> recreate
                assert.ok(hasVenvStub.calledOnce, 'hasVenv should be called once');
                assert.ok(pickExistingVenvActionStub.calledOnce, 'pickExistingVenvAction should be called once');
                assert.ok(deleteEnvironmentStub.calledOnce, 'deleteEnvironment should be called once');
                assert.ok(createUvVenvStub.calledOnce, 'createUvVenv should be called once');
                assert.ok(
                    hasVenvStub.calledBefore(pickExistingVenvActionStub),
                    'hasVenv should run before the action prompt',
                );
                assert.ok(
                    pickExistingVenvActionStub.calledBefore(deleteEnvironmentStub),
                    'action prompt should run before delete',
                );
                assert.ok(deleteEnvironmentStub.calledBefore(createUvVenvStub), 'delete should run before recreate');
            });

            test('Use Existing: keeps the existing venv without deleting or recreating', async () => {
                arrangeWorkspaceInstall();
                hasVenvStub.resolves(true);
                pickExistingVenvActionStub.resolves(venvUtils.ExistingVenvAction.UseExisting);
                getVenvExecutableStub.returns('/test/workspace/.venv/bin/python');

                const result = await installPythonViaUv();

                assert.strictEqual(result.success, true);
                assert.strictEqual(result.pythonPath, '/test/workspace/.venv/bin/python');
                assert.ok(getVenvExecutableStub.calledOnce, 'getVenvExecutable should resolve the existing env');
                assert.ok(!deleteEnvironmentStub.called, 'deleteEnvironment should not be called');
                assert.ok(!createUvVenvStub.called, 'createUvVenv should not be called');
            });

            test('No existing venv: creates directly without prompting', async () => {
                arrangeWorkspaceInstall();
                hasVenvStub.resolves(false);
                createUvVenvStub.resolves('/test/workspace/.venv/bin/python');

                const result = await installPythonViaUv();

                assert.strictEqual(result.success, true);
                assert.ok(!pickExistingVenvActionStub.called, 'should not prompt when no venv exists');
                assert.ok(!deleteEnvironmentStub.called, 'should not delete when no venv exists');
                assert.ok(createUvVenvStub.calledOnce, 'createUvVenv should be called once');
            });

            test('Global recreate: deletes existing ~/.venv before recreating', async () => {
                isUvInstalledStub.resolves(true);
                getAvailablePythonVersionsStub.resolves([
                    { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
                ]);
                quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
                execStub.onCall(0).resolves({ stdout: '' }); // uv python install
                execStub.onCall(1).resolves({ stdout: '/usr/local/bin/python3.13' }); // uv python find
                execStub.onCall(2).resolves({ stdout: '' }); // uv venv (global) recreate
                // No workspace -> global ~/.venv path
                getWorkspaceFoldersStub.returns(undefined);

                hasVenvStub.resolves(true);
                pickExistingVenvActionStub.resolves(venvUtils.ExistingVenvAction.Recreate);

                const result = await installPythonViaUv();

                assert.strictEqual(result.success, true);
                assert.strictEqual(result.pythonPath, getExpectedGlobalVenvPython());
                assert.ok(deleteEnvironmentStub.calledOnce, 'deleteEnvironment should be called once');
                assert.ok(
                    pickExistingVenvActionStub.calledBefore(deleteEnvironmentStub),
                    'action prompt should run before delete',
                );
            });
        });

        test('Returns error when uv python find returns empty string after install', async () => {
            isUvInstalledStub.resolves(true);
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            execStub.onFirstCall().resolves({ stdout: '' }); // uv python install succeeds
            execStub.onSecondCall().resolves({ stdout: '' }); // uv python find returns nothing

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('3.13'));
        });

        test('Dismissing "create venv?" notification falls back to base Python', async () => {
            isUvInstalledStub.resolves(true);
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version, then dismisses the "create venv?" notification (Escape)
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            when(mockedVSCodeNamespaces.window!.showInformationMessage(anything(), anything(), anything())).thenResolve(
                undefined,
            );
            execStub.onFirstCall().resolves({ stdout: '' });
            execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            const mockWorkspace = { uri: { fsPath: '/test/workspace' }, name: 'test', index: 0 };
            getWorkspaceFoldersStub.returns([mockWorkspace]);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
            assert.ok(!createUvVenvStub.called);
        });

        test('Handles unexpected errors gracefully', async () => {
            isUvInstalledStub.rejects(new Error('Unexpected error'));

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('Unexpected error'));
            assert.ok(traceErrorStub.called);
        });

        test('Skips uv python install when version is already installed (workspace)', async () => {
            isUvInstalledStub.resolves(true);
            getAvailablePythonVersionsStub.resolves([
                {
                    version: '3.13',
                    isInstalled: true,
                    path: '/usr/local/bin/python3.13',
                    identifier: 'cpython-3.13.1-macos-aarch64-none',
                },
            ]);
            // Selected item carries isInstalled and path
            quickPickResponses = [
                {
                    version: '3.13',
                    label: 'Python 3.13',
                    isInstalled: true,
                    path: '/usr/local/bin/python3.13',
                    identifier: 'cpython-3.13.1-macos-aarch64-none',
                },
            ];
            const mockWorkspace = { uri: { fsPath: '/test/workspace' }, name: 'test', index: 0 };
            getWorkspaceFoldersStub.returns([mockWorkspace]);
            createUvVenvStub.resolves('/test/workspace/.venv/bin/python');

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, '/test/workspace/.venv/bin/python');
            // No exec calls - install and find are both skipped
            assert.strictEqual(execStub.callCount, 0);
        });

        test('Skips uv python install when version is already installed (no workspace)', async () => {
            isUvInstalledStub.resolves(true);
            getAvailablePythonVersionsStub.resolves([
                {
                    version: '3.13',
                    isInstalled: true,
                    path: '/usr/local/bin/python3.13',
                    identifier: 'cpython-3.13.1-macos-aarch64-none',
                },
            ]);
            quickPickResponses = [
                {
                    version: '3.13',
                    label: 'Python 3.13',
                    isInstalled: true,
                    path: '/usr/local/bin/python3.13',
                    identifier: 'cpython-3.13.1-macos-aarch64-none',
                },
            ];
            getWorkspaceFoldersStub.returns(undefined);
            // Only the uv venv creation exec call should happen
            execStub.onFirstCall().resolves({ stdout: '' });

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, getExpectedGlobalVenvPython());
            // Only one exec call - for global venv creation (no install or find)
            assert.strictEqual(execStub.callCount, 1);
        });

        test('Reports progress at each step', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions via stub
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onFirstCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // uv venv creation succeeds (for global venv)
            execStub.onThirdCall().resolves({ stdout: '' });
            // No workspace
            getWorkspaceFoldersStub.returns(undefined);

            await installPythonViaUv();

            // Should report progress for selecting version and installing
            assert.ok(mockProgress.report.called);
        });

        test('Installs uv when not present and continues', async () => {
            // uv not installed initially
            isUvInstalledStub.onFirstCall().resolves(false);
            // After install, uv is located (e.g. via its known install location)
            isUvInstalledStub.resolves(true);
            // uv install succeeds (sh command)
            execStub.onCall(0).resolves({ stdout: '' });
            // After install, getAvailablePythonVersions returns versions
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onCall(1).resolves({ stdout: '' });
            // uv python find returns path
            execStub.onCall(2).resolves({ stdout: '/usr/local/bin/python3.13' });
            // uv venv creation succeeds (for global venv)
            execStub.onCall(3).resolves({ stdout: '' });
            // No workspace
            getWorkspaceFoldersStub.returns(undefined);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            // Should return the global venv path
            assert.strictEqual(result.pythonPath, getExpectedGlobalVenvPython());
        });

        test('Falls back to base Python when global venv creation fails', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions via stub
            getAvailablePythonVersionsStub.resolves([
                { version: '3.13', isInstalled: false, identifier: 'cpython-3.13.1-macos-aarch64-none' },
            ]);
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onFirstCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onSecondCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // uv venv creation fails
            execStub.onThirdCall().rejects(new Error('venv creation failed'));
            // No workspace open
            getWorkspaceFoldersStub.returns(undefined);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            // Should fall back to base Python path
            assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
        });
    });
});
