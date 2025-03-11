/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chaiAsPromised from 'chai-as-promised';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { assert, use as chaiUse } from 'chai';
import { Uri, WorkspaceConfiguration } from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as path from 'path';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';
import * as commandApis from '../../client/common/vscodeApis/commandApis';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as createEnvironmentApis from '../../client/pythonEnvironments/creation/createEnvironment';
import { IDisposableRegistry, IInterpreterPathService, IPathUtils } from '../../client/common/types';
import { registerCreateEnvironmentFeatures } from '../../client/pythonEnvironments/creation/createEnvApi';
import {
    CreateEnvironmentOptions,
    CreateEnvironmentProvider,
} from '../../client/pythonEnvironments/creation/proposed.createEnvApis';
import { CreateEnvironmentOptionsInternal } from '../../client/pythonEnvironments/creation/types';
import { IPythonRuntimeManager } from '../../client/positron/manager';
import { IInterpreterQuickPick } from '../../client/interpreter/configuration/types';
import { createEnvironmentAndRegister } from '../../client/positron/createEnvApi';
import { createTypeMoq } from '../mocks/helper';

chaiUse(chaiAsPromised.default);

suite('Positron Create Environment APIs', () => {
    let registerCommandStub: sinon.SinonStub;
    let handleCreateEnvironmentCommandStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;

    const disposables: IDisposableRegistry = [];
    const mockProvider = createTypeMoq<CreateEnvironmentProvider>();
    const mockProviders = [mockProvider.object];

    let pythonRuntimeManager: typemoq.IMock<IPythonRuntimeManager>;
    let pathUtils: typemoq.IMock<IPathUtils>;
    let interpreterQuickPick: typemoq.IMock<IInterpreterQuickPick>;
    let interpreterPathService: typemoq.IMock<IInterpreterPathService>;
    let workspaceConfig: typemoq.IMock<WorkspaceConfiguration>;

    // Test workspace
    const workspace1 = {
        uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
        name: 'workspace1',
        index: 0,
    };

    // Environment options
    const envOptions: CreateEnvironmentOptions & CreateEnvironmentOptionsInternal = {
        providerId: 'envProvider-id',
        interpreterPath: '/path/to/venv/python',
        workspaceFolder: workspace1,
    };
    const envOptionsWithInfo = {
        withInterpreterPath: { ...envOptions },
        withCondaPythonVersion: { ...envOptions, interpreterPath: undefined, condaPythonVersion: '3.12' },
    };
    const envOptionsMissingInfo = {
        noProviderId: { ...envOptions, providerId: undefined },
        noPythonSpecified: { ...envOptions, interpreterPath: undefined, condaPythonVersion: undefined },
    };

    setup(() => {
        registerCommandStub = sinon.stub(commandApis, 'registerCommand');
        handleCreateEnvironmentCommandStub = sinon.stub(createEnvironmentApis, 'handleCreateEnvironmentCommand');

        pythonRuntimeManager = createTypeMoq<IPythonRuntimeManager>();
        pathUtils = createTypeMoq<IPathUtils>();
        interpreterQuickPick = createTypeMoq<IInterpreterQuickPick>();
        interpreterPathService = createTypeMoq<IInterpreterPathService>();
        workspaceConfig = createTypeMoq<WorkspaceConfiguration>();

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        getConfigurationStub.callsFake((section?: string) => {
            if (section === 'python') {
                return workspaceConfig.object;
            }
            return undefined;
        });

        registerCommandStub.callsFake((_command: string, _callback: (...args: any[]) => any) => ({
            dispose: () => {
                // Do nothing
            },
        }));
        pathUtils.setup((p) => p.getDisplayName(typemoq.It.isAny())).returns(() => 'test');

        registerCreateEnvironmentFeatures(
            disposables,
            interpreterQuickPick.object,
            interpreterPathService.object,
            pathUtils.object,
            pythonRuntimeManager.object,
        );
    });

    teardown(() => {
        disposables.forEach((d) => d.dispose());
        sinon.restore();
    });

    Object.entries(envOptionsWithInfo).forEach(([optionsName, options]) => {
        test(`Environment creation succeeds when required options specified: ${optionsName}`, async () => {
            const resultPath = '/path/to/created/env';
            pythonRuntimeManager
                .setup((p) => p.registerLanguageRuntimeFromPath(resultPath))
                .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object))
                .verifiable(typemoq.Times.once());
            handleCreateEnvironmentCommandStub.returns(Promise.resolve({ path: resultPath }));

            const result = await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, options);

            assert.isDefined(result);
            assert.isDefined(result?.path);
            assert.isDefined(result?.metadata);
            assert.isUndefined(result?.error);
            assert.isTrue(handleCreateEnvironmentCommandStub.calledOnce);
            pythonRuntimeManager.verifyAll();
        });
    });

    Object.entries(envOptionsMissingInfo).forEach(([optionsName, options]) => {
        test(`Environment creation fails when options are missing: ${optionsName} `, async () => {
            pythonRuntimeManager
                .setup((p) => p.registerLanguageRuntimeFromPath(typemoq.It.isAny()))
                .returns(() => Promise.resolve(createTypeMoq<positron.LanguageRuntimeMetadata>().object))
                .verifiable(typemoq.Times.never());

            const result = await createEnvironmentAndRegister(mockProviders, pythonRuntimeManager.object, options);

            assert.isDefined(result);
            assert.isUndefined(result?.path);
            assert.isUndefined(result?.metadata);
            assert.isDefined(result?.error);
            assert.isTrue(handleCreateEnvironmentCommandStub.notCalled);
            pythonRuntimeManager.verifyAll();
        });
    });
});
