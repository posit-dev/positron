/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { InstallerResponse } from '../../client/common/types';
import * as externalDependencies from '../../client/pythonEnvironments/common/externalDependencies';

suite('CondaPythonPickerContribution', () => {
    let pathExistsSyncStub: sinon.SinonStub;

    setup(() => {
        pathExistsSyncStub = sinon.stub(externalDependencies, 'pathExistsSync');
        pathExistsSyncStub.returns(false);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('getItems', () => {
        test('should have correct language ID', () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');
            const mockServiceContainer = { get: () => ({}) };
            const contribution = new CondaPythonPickerContribution(mockServiceContainer);

            expect(contribution.languageId).to.equal('python');
        });

        test('should return items for conda envs without Python', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            const condaEnvWithoutPython = {
                path: 'python',
                envType: EnvironmentType.Conda,
                envName: 'testenv',
                envPath: '/Users/test/miniconda3/envs/testenv',
            } as PythonEnvironment;

            const condaEnvWithPython = {
                path: '/Users/test/miniconda3/envs/working/bin/python',
                envType: EnvironmentType.Conda,
                envName: 'working',
                envPath: '/Users/test/miniconda3/envs/working',
            } as PythonEnvironment;

            const venvEnv = {
                path: '/Users/test/project/.venv/bin/python',
                envType: EnvironmentType.Venv,
                envName: '.venv',
            } as PythonEnvironment;

            // The working conda env's python exists
            pathExistsSyncStub.withArgs('/Users/test/miniconda3/envs/working/bin/python').returns(true);

            const mockInterpreterService = {
                getInterpreters: () => [condaEnvWithoutPython, condaEnvWithPython, venvEnv],
            };
            const mockServiceContainer = {
                get: () => mockInterpreterService,
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);
            const items = await contribution.getItems();

            expect(items).to.have.lengthOf(1);
            expect(items[0].id).to.equal('/Users/test/miniconda3/envs/testenv');
            expect(items[0].label).to.include('Install Python');
            expect(items[0].label).to.include('testenv');
        });

        test('should return empty array when no problematic conda envs exist', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            const workingEnv = {
                path: '/Users/test/miniconda3/envs/working/bin/python',
                envType: EnvironmentType.Conda,
                envName: 'working',
                envPath: '/Users/test/miniconda3/envs/working',
            } as PythonEnvironment;

            pathExistsSyncStub.withArgs('/Users/test/miniconda3/envs/working/bin/python').returns(true);

            const mockInterpreterService = {
                getInterpreters: () => [workingEnv],
            };
            const mockServiceContainer = {
                get: () => mockInterpreterService,
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);
            const items = await contribution.getItems();

            expect(items).to.have.lengthOf(0);
        });

        test('should only show separator on first item', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            const env1 = {
                path: 'python',
                envType: EnvironmentType.Conda,
                envName: 'env1',
                envPath: '/envs/env1',
            } as PythonEnvironment;

            const env2 = {
                path: 'python',
                envType: EnvironmentType.Conda,
                envName: 'env2',
                envPath: '/envs/env2',
            } as PythonEnvironment;

            const mockInterpreterService = { getInterpreters: () => [env1, env2] };
            const mockServiceContainer = { get: () => mockInterpreterService };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);
            const items = await contribution.getItems();

            expect(items).to.have.lengthOf(2);
            expect(items[0].separatorLabel).to.equal('Install Python');
            expect(items[1].separatorLabel).to.be.undefined;
        });
    });

    suite('installPythonInCondaEnv (via private access)', () => {
        test('should return installed:false when interpreter details not found', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            const mockInterpreterService = {
                getInterpreterDetails: async () => null,
            };

            const mockServiceContainer = {
                get: () => mockInterpreterService,
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);
            const result = await contribution['installPythonInCondaEnv']('/fake/path/python');

            expect(result.installed).to.be.false;
        });

        test('should return installed:false when installer fails', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');

            const mockInterpreterService = {
                getInterpreterDetails: async () => ({
                    envPath: '/Users/test/miniconda3/envs/test1',
                }),
            };
            const mockInstaller = {
                install: async () => InstallerResponse.Disabled,
            };

            const mockServiceContainer = {
                get: (serviceType: any) => {
                    const serviceStr = serviceType.toString();
                    if (serviceStr.includes('IInstaller')) {
                        return mockInstaller;
                    }
                    return mockInterpreterService;
                },
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);
            const result = await contribution['installPythonInCondaEnv']('/fake/path/python');

            expect(result.installed).to.be.false;
        });

        test('should return installed:true with actual path when installer succeeds', async () => {
            const { CondaPythonPickerContribution } = require('../../client/positron/condaPickerContribution');
            const fsExtra = require('fs-extra');

            const envPath = '/Users/test/miniconda3/envs/test1';
            const actualPythonPath =
                process.platform === 'win32'
                    ? path.join(envPath, 'Scripts', 'python.exe')
                    : path.join(envPath, 'bin', 'python');

            // Stub fs.existsSync so getCondaPythonPath finds the python binary
            const existsSyncStub = sinon.stub(fsExtra, 'existsSync');
            existsSyncStub.withArgs(actualPythonPath).returns(true);
            existsSyncStub.callThrough();

            const mockInterpreterService = {
                getInterpreterDetails: async () => ({ envPath }),
            };
            const mockInstaller = {
                install: async () => InstallerResponse.Installed,
            };

            const mockServiceContainer = {
                get: (serviceType: any) => {
                    const serviceStr = serviceType.toString();
                    if (serviceStr.includes('IInstaller')) {
                        return mockInstaller;
                    }
                    return mockInterpreterService;
                },
            };

            const contribution = new CondaPythonPickerContribution(mockServiceContainer);
            const result = await contribution['installPythonInCondaEnv']('/fake/path/python');

            expect(result.installed).to.be.true;
            expect(result.actualPythonPath).to.equal(actualPythonPath);

            existsSyncStub.restore();
        });
    });
});
