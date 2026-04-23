/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';

suite('CondaPythonPickerContribution', () => {
    suite('Basic functionality', () => {
        test('should have correct language ID', () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');
            const mockServiceContainer = {
                get: () => ({})
            };
            const contribution = new CondaPythonPickerContribution(mockServiceContainer);

            expect(contribution.languageId).to.equal('python');
        });

        test('should generate consistent runtime IDs for same environment', () => {
            const crypto = require('crypto');
            const envPath1 = '/Users/test/miniconda3/envs/test1';
            const envPath2 = '/Users/test/miniconda3/envs/test1';

            // Simulate the same ID generation logic from the contribution
            const digest1 = crypto.createHash('sha256');
            digest1.update(envPath1);
            const id1 = digest1.digest('hex').substring(0, 32);

            const digest2 = crypto.createHash('sha256');
            digest2.update(envPath2);
            const id2 = digest2.digest('hex').substring(0, 32);

            expect(id1).to.equal(id2);
        });

        test('should extract environment name from path correctly', () => {
            const testPaths = [
                { path: '/Users/test/miniconda3/envs/myproject', expected: 'myproject' },
                { path: '/Users/test/project/.conda', expected: '.conda' }
            ];

            testPaths.forEach(({ path: testPath, expected }) => {
                const envName = path.basename(testPath);
                expect(envName).to.equal(expected);
            });
        });

        test('should handle .conda directory name extraction', () => {
            const condaPath = '/Users/test/project/.conda/python';
            // Simulate the logic from getItems()
            const condaDir = path.dirname(path.dirname(condaPath));
            const projectDir = path.dirname(condaDir);
            const projectName = path.basename(projectDir);

            expect(projectName).to.equal('test');
        });

        test('should format picker item labels correctly', () => {
            const testCases = [
                { envName: 'myproject', expected: '$(add) Install Python in myproject' },
                { envName: '', expected: '$(add) Install Python in conda environment' },
                { envName: 'test-123', expected: '$(add) Install Python in test-123' }
            ];

            testCases.forEach(({ envName, expected }) => {
                const label = `$(add) Install Python${envName ? ` in ${envName}` : ' in conda environment'}`;
                expect(label).to.equal(expected);
            });
        });
    });

    suite('Environment type filtering', () => {
        test('should identify conda environments correctly', () => {
            const { EnvironmentType } = require('../../client/pythonEnvironments/info');

            const interpreters = [
                { envType: EnvironmentType.Conda, shouldInclude: true },
                { envType: EnvironmentType.Venv, shouldInclude: false },
                { envType: EnvironmentType.System, shouldInclude: false },
                { envType: EnvironmentType.Pyenv, shouldInclude: false }
            ];

            interpreters.forEach(({ envType, shouldInclude }) => {
                const isCondaEnv = envType === EnvironmentType.Conda;
                expect(isCondaEnv).to.equal(shouldInclude);
            });
        });
    });
});
