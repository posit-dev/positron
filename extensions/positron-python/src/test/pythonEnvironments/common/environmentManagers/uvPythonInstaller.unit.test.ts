/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { anything, when, reset } from 'ts-mockito';
import * as fileUtils from '../../../../client/pythonEnvironments/common/externalDependencies';
import * as logging from '../../../../client/logging';
import * as uv from '../../../../client/pythonEnvironments/common/environmentManagers/uv';
import * as workspaceApis from '../../../../client/common/vscodeApis/workspaceApis';
import * as uvCreationProvider from '../../../../client/pythonEnvironments/creation/provider/uvCreationProvider';
import {
    getAvailablePythonVersions,
    installPythonViaUv,
} from '../../../../client/pythonEnvironments/common/environmentManagers/uvPythonInstaller';
import { mockedVSCodeNamespaces } from '../../../vscode-mock';

suite('UV Python Installer Tests', () => {
    let execStub: sinon.SinonStub;
    let traceErrorStub: sinon.SinonStub;

    setup(() => {
        execStub = sinon.stub(fileUtils, 'exec');
        traceErrorStub = sinon.stub(logging, 'traceError');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('getAvailablePythonVersions Tests', () => {
        test('Returns empty array when uv python list fails', async () => {
            execStub.rejects(new Error('Command failed'));

            const result = await getAvailablePythonVersions();

            assert.deepStrictEqual(result, []);
            assert.ok(traceErrorStub.calledWith(sinon.match(/Failed to get available Python versions/)));
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
            when(mockedVSCodeNamespaces.window!.showInformationMessage(anything())).thenResolve(undefined);

            mockProgress.report.reset();
        });

        test('Returns cancelled when user cancels version selection', async () => {
            isUvInstalledStub.resolves(true);
            // Return available versions
            execStub.resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User cancels quick pick
            quickPickResponses = [undefined];

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Cancelled');
        });

        test('Returns error when uv installation fails', async () => {
            // uv not installed initially
            isUvInstalledStub.resolves(false);
            // uv install command fails
            execStub.rejects(new Error('Installation failed'));

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.ok(result.error);
        });

        test('Returns error when uv installed but not available in PATH', async () => {
            // uv not installed initially, then still not available after install attempt
            isUvInstalledStub.onFirstCall().resolves(false);
            isUvInstalledStub.onSecondCall().resolves(false);
            // uv install command succeeds
            execStub.resolves({ stdout: '' });

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.ok(traceErrorStub.calledWith('uv installed but not available in current process PATH'));
        });

        test('Returns error when Python installation fails', async () => {
            isUvInstalledStub.resolves(true);
            // First call: uv python list returns versions
            execStub.onFirstCall().resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // Second call: uv python install fails
            execStub.onSecondCall().rejects(new Error('Install failed'));

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('3.13'));
        });

        test('Returns error when no Python versions available', async () => {
            isUvInstalledStub.resolves(true);
            // No versions available
            execStub.resolves({ stdout: '' });

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, false);
            // Error message shown via vscode.window.showErrorMessage
        });

        test('Succeeds without venv when no workspace is open', async () => {
            isUvInstalledStub.resolves(true);
            // uv python list
            execStub.onFirstCall().resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onSecondCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onThirdCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // No workspace open
            getWorkspaceFoldersStub.returns(undefined);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
        });

        test('Succeeds with venv creation when user accepts', async () => {
            isUvInstalledStub.resolves(true);
            // uv python list
            execStub.onFirstCall().resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User selects version, then accepts venv creation
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }, { id: 'yes', label: 'Yes' }];
            // uv python install succeeds
            execStub.onSecondCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onThirdCall().resolves({ stdout: '/usr/local/bin/python3.13' });
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
            // uv python list
            execStub.onFirstCall().resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User selects version, then declines venv creation
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }, { id: 'no', label: 'No' }];
            // uv python install succeeds
            execStub.onSecondCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onThirdCall().resolves({ stdout: '/usr/local/bin/python3.13' });
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
            // uv python list
            execStub.onFirstCall().resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User selects version, then accepts venv creation
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }, { id: 'yes', label: 'Yes' }];
            // uv python install succeeds
            execStub.onSecondCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onThirdCall().resolves({ stdout: '/usr/local/bin/python3.13' });
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
            // uv python list
            execStub.onFirstCall().resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onSecondCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onThirdCall().resolves({ stdout: '/usr/local/bin/python3.13' });
            // No workspace
            getWorkspaceFoldersStub.returns(undefined);

            await installPythonViaUv();

            // Should report progress for selecting version and installing
            assert.ok(mockProgress.report.called);
        });

        test('Installs uv when not present and continues', async () => {
            // uv not installed initially, then available after install
            isUvInstalledStub.onFirstCall().resolves(false);
            isUvInstalledStub.onSecondCall().resolves(true);
            // uv install succeeds (sh command)
            execStub.onFirstCall().resolves({ stdout: '' });
            // uv python list
            execStub.onSecondCall().resolves({
                stdout: 'cpython-3.13.1-macos-aarch64-none    <download available>',
            });
            // User selects version
            quickPickResponses = [{ version: '3.13', label: 'Python 3.13' }];
            // uv python install succeeds
            execStub.onThirdCall().resolves({ stdout: '' });
            // uv python find returns path
            execStub.onCall(3).resolves({ stdout: '/usr/local/bin/python3.13' });
            // No workspace
            getWorkspaceFoldersStub.returns(undefined);

            const result = await installPythonViaUv();

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.pythonPath, '/usr/local/bin/python3.13');
        });
    });
});
