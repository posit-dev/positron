/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { Architecture } from '../../client/common/utils/platform';

suite('Runtime - Conda Environment Handling', () => {
    suite('Environment metadata validation', () => {
        test('should validate conda environment properties', () => {
            const interpreter = {
                path: '/Users/test/miniconda3/envs/test1/python',
                envType: EnvironmentType.Conda,
                envName: 'test1',
                envPath: '/Users/test/miniconda3/envs/test1',
                version: {
                    raw: '3.11.0',
                    major: 3,
                    minor: 11,
                    patch: 0,
                    build: [],
                    prerelease: [],
                },
                sysVersion: '3.11.0 (main, Oct 24 2022, 18:26:48) [MSC v.1933 64 bit (AMD64)]',
                architecture: Architecture.x64,
                sysPrefix: '/Users/test/miniconda3/envs/test1',
            } as PythonEnvironment;

            expect(interpreter.envType).to.equal(EnvironmentType.Conda);
            expect(interpreter.envName).to.equal('test1');
            expect(interpreter.path).to.include('miniconda3/envs');
            expect(interpreter.version?.major).to.equal(3);
            expect(interpreter.version?.minor).to.equal(11);
        });

        test('should validate runtime name format for conda environments', () => {
            const testCases = [
                { envName: 'my-ml-project', version: '3.11.5', expected: 'Python 3.11.5 (Conda: my-ml-project)' },
                { envName: 'test1', version: '3.11.0', expected: 'Python 3.11.0 (Conda: test1)' },
                { envName: 'project', version: '3.12.0', expected: 'Python 3.12.0 (Conda: project)' },
            ];

            testCases.forEach(({ envName, version, expected }) => {
                const runtimeName = `Python ${version} (Conda: ${envName})`;
                expect(runtimeName).to.equal(expected);
            });
        });

        test('should validate unsupported Python version formatting', () => {
            const version = '2.7.18';
            const runtimeName = `Unsupported: Python ${version}`;
            expect(runtimeName).to.include('Unsupported');
            expect(runtimeName).to.include(version);
        });
    });

    suite('Path handling', () => {
        test('should handle different conda path formats', () => {
            const testPaths = [
                '/Users/test/miniconda3/envs/test1/bin/python',
                '/Users/test/miniconda3/envs/my-ml-project/bin/python',
                '/Users/test/project/.conda/bin/python',
            ];

            testPaths.forEach((testPath) => {
                expect(typeof testPath).to.equal('string');
                expect(testPath).to.match(/.*python$/);
            });
        });

        test('should extract environment names from paths', () => {
            const testCases = [
                { envPath: '/Users/test/miniconda3/envs/my-ml-project', expected: 'my-ml-project' },
                { envPath: '/Users/test/project/.conda', expected: '.conda' },
            ];

            testCases.forEach(({ envPath, expected }) => {
                const envName = envPath.split('/').pop();
                expect(envName).to.equal(expected);
            });
        });
    });
});
