/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fileUtils from '../../../../client/pythonEnvironments/common/externalDependencies';
import * as logging from '../../../../client/logging';
import { getAvailablePythonVersions } from '../../../../client/pythonEnvironments/common/environmentManagers/uvPythonInstaller';

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
});
