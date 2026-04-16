/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { anything, when, reset } from 'ts-mockito';
import * as fileUtils from '../../../../client/pythonEnvironments/common/externalDependencies';
import * as logging from '../../../../client/logging';
import * as uv from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as workspaceApis from '../../../../client/common/vscodeApis/workspaceApis';
import * as uvCreationProvider from '../../../../client/pythonEnvironments/creation/provider/uvCreationProvider';
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

            // Should only have 3.13 and 3.12 (first occurrence of each minor version)
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].version, '3.13');
            assert.strictEqual(result[1].version, '3.12');
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
            when(mockedVSCodeNamespaces.window!.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                InterpreterQuickPickList.UvInstall.confirmUvInstallYes as any,
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
            // User selects version, then accepts venv creation
            quickPickResponses = [
                { version: '3.13', label: 'Python 3.13' },
                { id: 'yes', label: 'Yes' },
            ];
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
            // User selects version, then declines venv creation
            quickPickResponses = [
                { version: '3.13', label: 'Python 3.13' },
                { id: 'no', label: 'No' },
            ];
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
            // User selects version, then accepts venv creation
            quickPickResponses = [
                { version: '3.13', label: 'Python 3.13' },
                { id: 'yes', label: 'Yes' },
            ];
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

        test('Handles unexpected errors gracefully', async () => {
            isUvInstalledStub.rejects(new Error('Unexpected error'));

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('Unexpected error'));
            assert.ok(traceErrorStub.called);
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
