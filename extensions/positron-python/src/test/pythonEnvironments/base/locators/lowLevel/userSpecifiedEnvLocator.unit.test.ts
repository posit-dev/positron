/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable consistent-return */

import * as path from 'path';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import { WorkspaceConfiguration } from 'vscode';
import * as fs from '../../../../../client/common/platform/fs-paths';
import * as workspaceApis from '../../../../../client/common/vscodeApis/workspaceApis';
import { PythonEnvKind } from '../../../../../client/pythonEnvironments/base/info';
import { getEnvs } from '../../../../../client/pythonEnvironments/base/locatorUtils';
import { UserSpecifiedEnvironmentLocator } from '../../../../../client/pythonEnvironments/base/locators/lowLevel/userSpecifiedEnvLocator';
import { createBasicEnv } from '../../common';
import { TEST_LAYOUT_ROOT } from '../../../common/commonTestConstants';
import { assertBasicEnvsEqual } from '../envTestUtils';
import { createTypeMoq } from '../../../../mocks/helper';
import { INTERPRETERS_INCLUDE_SETTING_KEY } from '../../../../../client/common/constants';
import { getOSType, OSType } from '../../../../common';

/**
 * Helper class to create fake executables for the user specified environments locator.
 */
class UserSpecifiedEnvs {
    /**
     * The list of executables that have been created.
     */
    private _executables: string[] = [];

    /**
     * Constructor.
     * @param root The root directory where the executables will be created
     */
    constructor(private readonly root: string) {}

    /**
     * Creates a fake executable at the specified path. The path can be relative to the root directory.
     * @param interpreterPath The path to the interpreter to create, including the executable name.
     * @returns The full path to the created executable.
     */
    public async create(interpreterPath: string): Promise<string> {
        const filePath = path.isAbsolute(interpreterPath) ? interpreterPath : path.join(this.root, interpreterPath);

        try {
            await fs.createFile(filePath);
        } catch (err) {
            throw new Error(`Failed to create executable ${interpreterPath} at ${filePath}, Error: ${err}`);
        }

        // Add the executable to the list of created executables so that they can be cleaned up later.
        this._executables.push(filePath);
        return filePath;
    }

    get executables(): string[] {
        return this._executables;
    }
}

const customWindowsEnvs = [
    'my\\custom\\dir\\for\\pythons\\python-main\\python.exe',
    'another\\dir\\for\\pythons\\python.exe',
];

const customPosixEnvs = ['my/custom/dir/for/pythons/python-main/bin/python', 'another/dir/for/pythons/python'];

suite('UserSpecifiedEnvironment Locator', () => {
    const userSpecifiedEnvsRoot = path.join(TEST_LAYOUT_ROOT, 'userSpecifiedEnvs', 'envs');
    const userSpecifiedEnvs = new UserSpecifiedEnvs(userSpecifiedEnvsRoot);
    let locator: UserSpecifiedEnvironmentLocator;
    let pythonConfig: TypeMoq.IMock<WorkspaceConfiguration>;
    let getConfigurationStub: sinon.SinonStub;

    // Setup before all tests
    suiteSetup(async () => {
        // Set up the python configuration settings mocks/stubs
        pythonConfig = createTypeMoq<WorkspaceConfiguration>();
        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string) => {
            if (section === 'python') {
                return pythonConfig.object;
            }
            return undefined;
        });

        // Create the fake custom environments for the appropriate OS
        if (getOSType() === OSType.Windows) {
            await Promise.all(customWindowsEnvs.map((env) => userSpecifiedEnvs.create(env)));
        } else {
            await Promise.all(customPosixEnvs.map((env) => userSpecifiedEnvs.create(env)));
        }
    });

    // Setup before each test
    setup(async () => {
        locator = new UserSpecifiedEnvironmentLocator();
    });

    // Teardown after each test
    teardown(async () => {
        await locator.dispose();
    });

    // Teardown after all tests
    suiteTeardown(async () => {
        // Remove the fake executables that were created
        await fs.rmdir(userSpecifiedEnvsRoot, { recursive: true });

        sinon.restore();
    });

    test('iterEnvs(): Windows', async function () {
        // Skip this test if the OS is not Windows
        if (getOSType() !== OSType.Windows) {
            return this.skip();
        }

        // Configure the user setting to include custom directories
        pythonConfig
            .setup((p) => p.get(INTERPRETERS_INCLUDE_SETTING_KEY))
            .returns(() => [
                `${userSpecifiedEnvsRoot}\\my\\custom\\dir\\for\\pythons`,
                `${userSpecifiedEnvsRoot}\\another\\dir\\for\\pythons`,
            ]);

        // These are the expected environments that should be located
        const expectedEnvs = userSpecifiedEnvs.executables.map((e: string) => createBasicEnv(PythonEnvKind.Custom, e));

        // Locate the environments and compare them to the expected environments
        const iterator = locator.iterEnvs();
        const actualEnvs = await getEnvs(iterator);
        assertBasicEnvsEqual(actualEnvs, expectedEnvs);
    });

    test('iterEnvs(): Non-Windows', async function () {
        // Skip this test on Windows
        if (getOSType() === OSType.Windows) {
            return this.skip();
        }

        // Configure the user setting to include custom directories
        pythonConfig
            .setup((p) => p.get(INTERPRETERS_INCLUDE_SETTING_KEY))
            .returns(() => [
                `${userSpecifiedEnvsRoot}/my/custom/dir/for/pythons`,
                `${userSpecifiedEnvsRoot}/another/dir/for/pythons`,
            ]);

        // These are the expected environments that should be located
        const expectedEnvs = userSpecifiedEnvs.executables.map((e: string) => createBasicEnv(PythonEnvKind.Custom, e));

        // Locate the environments and compare them to the expected environments
        const iterator = locator.iterEnvs();
        const actualEnvs = await getEnvs(iterator);
        assertBasicEnvsEqual(actualEnvs, expectedEnvs);
    });
});
