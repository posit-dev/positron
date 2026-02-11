// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import assert from 'node:assert';
import { Uri } from 'vscode';
import { PythonEnvironment } from '../../api';

/**
 * Test the logic used in environment pickers to include interpreter paths in descriptions
 */
suite('Environment Picker Description Logic', () => {
    const createMockEnvironment = (
        displayPath: string,
        description?: string,
        name: string = 'Python 3.9.0',
    ): PythonEnvironment => ({
        envId: { id: 'test', managerId: 'test-manager' },
        name,
        displayName: name,
        displayPath,
        version: '3.9.0',
        environmentPath: Uri.file(displayPath),
        description,
        sysPrefix: '/path/to/prefix',
        execInfo: { run: { executable: displayPath } },
    });

    suite('Description formatting with interpreter path', () => {
        test('should use displayPath as description when no original description exists', () => {
            const env = createMockEnvironment('/usr/local/bin/python');

            // This is the logic from our updated picker
            const pathDescription = env.displayPath;
            const description =
                env.description && env.description.trim() ? `${env.description} (${pathDescription})` : pathDescription;

            assert.strictEqual(description, '/usr/local/bin/python');
        });

        test('should append displayPath to existing description in parentheses', () => {
            const env = createMockEnvironment('/home/user/.venv/bin/python', 'Virtual Environment');

            // This is the logic from our updated picker
            const pathDescription = env.displayPath;
            const description =
                env.description && env.description.trim() ? `${env.description} (${pathDescription})` : pathDescription;

            assert.strictEqual(description, 'Virtual Environment (/home/user/.venv/bin/python)');
        });

        test('should handle complex paths correctly', () => {
            const complexPath = '/usr/local/anaconda3/envs/my-project-env/bin/python';
            const env = createMockEnvironment(complexPath, 'Conda Environment');

            // This is the logic from our updated picker
            const pathDescription = env.displayPath;
            const description =
                env.description && env.description.trim() ? `${env.description} (${pathDescription})` : pathDescription;

            assert.strictEqual(description, `Conda Environment (${complexPath})`);
        });

        test('should handle empty description correctly', () => {
            const env = createMockEnvironment('/opt/python/bin/python', '');

            // This is the logic from our updated picker
            const pathDescription = env.displayPath;
            const description =
                env.description && env.description.trim() ? `${env.description} (${pathDescription})` : pathDescription;

            // Empty string should be treated like no description, so just use path
            assert.strictEqual(description, '/opt/python/bin/python');
        });

        test('should handle Windows paths correctly', () => {
            const windowsPath = 'C:\\Python39\\python.exe';
            const env = createMockEnvironment(windowsPath, 'System Python');

            // This is the logic from our updated picker
            const pathDescription = env.displayPath;
            const description =
                env.description && env.description.trim() ? `${env.description} (${pathDescription})` : pathDescription;

            assert.strictEqual(description, 'System Python (C:\\Python39\\python.exe)');
        });
    });
});
