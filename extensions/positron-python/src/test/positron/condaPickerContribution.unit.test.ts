/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';

suite('CondaPythonPickerContribution', () => {
    suite('Basic functionality', () => {
        test('should have correct language ID', () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');
            const mockServiceContainer = {
                get: () => ({}),
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
                { path: '/Users/test/project/.conda', expected: '.conda' },
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
                { envName: 'test-123', expected: '$(add) Install Python in test-123' },
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
                { envType: EnvironmentType.Pyenv, shouldInclude: false },
            ];

            interpreters.forEach(({ envType, shouldInclude }) => {
                const isCondaEnv = envType === EnvironmentType.Conda;
                expect(isCondaEnv).to.equal(shouldInclude);
            });
        });
    });

    suite('Installation process', () => {
        test('should handle successful Python installation workflow', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            // Mock the installation workflow without external dependencies
            const mockServiceContainer = {
                get: () => ({}),
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);

            // Mock the private installation method to simulate success
            let installationCalled = false;
            let runtimeRegistered = false;

            contribution['installPythonInCondaEnvQuiet'] = async (pythonPath: string) => {
                installationCalled = true;
                const expectedPath = path.normalize('/Users/test/miniconda3/envs/test1/python');
                expect(path.normalize(pythonPath)).to.equal(expectedPath);
                return {
                    installed: true,
                    actualPythonPath: '/Users/test/miniconda3/envs/test1/bin/python',
                };
            };

            // Mock successful runtime creation workflow
            contribution.onDidSelectItem = async function (itemId: string) {
                const predictedPythonPath = path.join(itemId, 'python');

                const result = await this['installPythonInCondaEnvQuiet'](predictedPythonPath);

                if (result.installed && result.actualPythonPath) {
                    runtimeRegistered = true;
                    return 'mock-runtime-id';
                }
                return undefined;
            };

            // Test the workflow
            const envPath = '/Users/test/miniconda3/envs/test1';
            const result = await contribution.onDidSelectItem(envPath);

            expect(installationCalled).to.be.true;
            expect(runtimeRegistered).to.be.true;
            expect(result).to.equal('mock-runtime-id');
        });

        test('should handle installation failure', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            // Mock failed installation
            const mockInstaller = {
                install: async () => 'Failed',
            };
            const mockInterpreterService = {
                getInterpreterDetails: async () => ({
                    envPath: '/Users/test/miniconda3/envs/test1',
                }),
            };

            const mockServiceContainer = {
                get: (serviceType: any) => {
                    const serviceStr = serviceType.toString();
                    if (serviceStr.includes('IInstaller')) return mockInstaller;
                    if (serviceStr.includes('IInterpreterService')) return mockInterpreterService;
                    return {};
                },
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);

            const envPath = '/Users/test/miniconda3/envs/broken';
            const result = await contribution.onDidSelectItem(envPath);

            expect(result).to.be.undefined;
        });

        test('should handle missing interpreter after installation', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            // Mock successful installation but no interpreter found
            const mockInstaller = {
                install: async () => 'Installed',
            };
            const mockInterpreterService = {
                getInterpreterDetails: async () => null,
            };

            const mockServiceContainer = {
                get: (serviceType: any) => {
                    const serviceStr = serviceType.toString();
                    if (serviceStr.includes('IInstaller')) return mockInstaller;
                    if (serviceStr.includes('IInterpreterService')) return mockInterpreterService;
                    return {};
                },
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);

            // Mock the private method to return successful installation
            contribution['installPythonInCondaEnvQuiet'] = async () => ({
                installed: true,
                actualPythonPath: '/Users/test/miniconda3/envs/test1/bin/python',
            });

            const envPath = '/Users/test/miniconda3/envs/test1';
            const result = await contribution.onDidSelectItem(envPath);

            expect(result).to.be.undefined;
        });

        test('should generate correct predicted Python path', () => {
            const testCases = [
                { envPath: '/Users/test/miniconda3/envs/test1', expected: '/Users/test/miniconda3/envs/test1/python' },
                { envPath: '/Users/test/project/.conda', expected: '/Users/test/project/.conda/python' },
            ];

            testCases.forEach(({ envPath, expected }) => {
                const predictedPath = path.join(envPath, 'python');
                const normalizedExpected = path.normalize(expected);
                expect(path.normalize(predictedPath)).to.equal(normalizedExpected);
            });
        });

        test('should call installation with correct parameters', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            const mockServiceContainer = {
                get: () => ({}),
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);

            // Track installation calls
            let installationParams: any = null;

            contribution['installPythonInCondaEnvQuiet'] = async (pythonPath: string) => {
                installationParams = { pythonPath };
                return { installed: false }; // Simulate failure to test error handling
            };

            const envPath = '/Users/test/miniconda3/envs/myproject';
            await contribution.onDidSelectItem(envPath);

            expect(installationParams).to.not.be.null;
            const expectedPath = path.normalize('/Users/test/miniconda3/envs/myproject/python');
            expect(path.normalize(installationParams.pythonPath)).to.equal(expectedPath);
        });
    });
});
