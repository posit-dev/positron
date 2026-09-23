// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import * as sinon from 'sinon';
import { Uri, WorkspaceConfiguration } from 'vscode';
import * as triggerUtils from '../../../client/pythonEnvironments/creation/common/createEnvTriggerUtils';
import * as commonUtils from '../../../client/pythonEnvironments/creation/common/commonUtils';
import * as windowApis from '../../../client/common/vscodeApis/windowApis';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import {
    CreateEnvironmentCheckKind,
    triggerCreateEnvironmentCheck,
    // --- Start Positron ---
    registerCreateEnvironmentTriggers,
    // --- End Positron ---
} from '../../../client/pythonEnvironments/creation/createEnvironmentTrigger';
import * as workspaceApis from '../../../client/common/vscodeApis/workspaceApis';
import * as commandApis from '../../../client/common/vscodeApis/commandApis';
// --- Start Positron ---
// import { Commands } from '../../../client/common/constants';
// import { Common, CreateEnv } from '../../../client/common/utils/localize';
import { Common, CreateEnv } from '../../../client/common/utils/localize';
import * as autoCreateVenv from '../../../client/pythonEnvironments/creation/provider/autoCreateVenv';
import * as autoCreateLockFileEnv from '../../../client/pythonEnvironments/creation/provider/autoCreateLockFileEnv';
import { IPythonRuntimeManager } from '../../../client/positron/manager';
import * as fsapi from '../../../client/common/platform/fs-paths';
import * as pixiModule from '../../../client/pythonEnvironments/common/environmentManagers/pixi';
// --- End Positron ---

suite('Create Environment Trigger', () => {
    let shouldPromptToCreateEnvStub: sinon.SinonStub;
    let hasVenvStub: sinon.SinonStub;
    let hasPrefixCondaEnvStub: sinon.SinonStub;
    let hasRequirementFilesStub: sinon.SinonStub;
    let hasKnownFilesStub: sinon.SinonStub;
    let isGlobalPythonSelectedStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let isCreateEnvWorkspaceCheckNotRunStub: sinon.SinonStub;
    let getWorkspaceFolderStub: sinon.SinonStub;
    // --- Start Positron ---
    // let executeCommandStub: sinon.SinonStub;
    // --- End Positron ---
    let disableCreateEnvironmentTriggerStub: sinon.SinonStub;
    // --- Start Positron ---
    let autoCreateVenvWithDepsStub: sinon.SinonStub;
    let hasShownCreateEnvModalStub: sinon.SinonStub;
    let pathExistsStub: sinon.SinonStub;
    let hasPixiEnvStub: sinon.SinonStub;
    let getPixiStub: sinon.SinonStub;
    let allowUvPythonInstall: boolean | undefined;
    let autoSyncUvEnvStub: sinon.SinonStub;
    let autoInstallPixiEnvStub: sinon.SinonStub;
    let showPixiNotInstalledWarningStub: sinon.SinonStub;
    const pythonRuntimeManager = {} as IPythonRuntimeManager;
    const pixi = {} as pixiModule.Pixi;
    // --- End Positron ---

    const workspace1 = {
        uri: Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'workspace1')),
        name: 'workspace1',
        index: 0,
    };

    setup(() => {
        shouldPromptToCreateEnvStub = sinon.stub(triggerUtils, 'shouldPromptToCreateEnv');
        hasVenvStub = sinon.stub(commonUtils, 'hasVenv');
        hasPrefixCondaEnvStub = sinon.stub(commonUtils, 'hasPrefixCondaEnv');
        hasRequirementFilesStub = sinon.stub(triggerUtils, 'hasRequirementFiles');
        // --- Start Positron ---
        sinon.stub(triggerUtils, 'hasPyprojectToml').resolves(false);
        // --- End Positron ---
        hasKnownFilesStub = sinon.stub(triggerUtils, 'hasKnownFiles');
        isGlobalPythonSelectedStub = sinon.stub(triggerUtils, 'isGlobalPythonSelected');
        showInformationMessageStub = sinon.stub(windowApis, 'showInformationMessage');

        isCreateEnvWorkspaceCheckNotRunStub = sinon.stub(triggerUtils, 'isCreateEnvWorkspaceCheckNotRun');
        isCreateEnvWorkspaceCheckNotRunStub.returns(true);

        getWorkspaceFolderStub = sinon.stub(workspaceApis, 'getWorkspaceFolder');
        getWorkspaceFolderStub.returns(workspace1);

        // --- Start Positron ---
        sinon.stub(commandApis, 'executeCommand');
        // --- End Positron ---
        disableCreateEnvironmentTriggerStub = sinon.stub(triggerUtils, 'disableCreateEnvironmentTrigger');
        // --- Start Positron ---
        sinon
            .stub(autoCreateVenv, 'detectAutoCreateContext')
            .resolves({ hasRequirements: true, hasPyprojectToml: false, uvAvailable: true });
        sinon.stub(autoCreateVenv, 'describeDepFiles').returns('requirements.txt');
        sinon.stub(autoCreateVenv, 'describeTool').returns('uv');
        autoCreateVenvWithDepsStub = sinon.stub(autoCreateVenv, 'autoCreateVenvWithDeps');
        autoCreateVenvWithDepsStub.resolves(undefined);
        hasShownCreateEnvModalStub = sinon.stub(triggerUtils, 'hasShownCreateEnvModal');
        hasShownCreateEnvModalStub.returns(false);
        pathExistsStub = sinon.stub(fsapi, 'pathExists');
        pathExistsStub.resolves(false);
        hasPixiEnvStub = sinon.stub(commonUtils, 'hasPixiEnv');
        hasPixiEnvStub.resolves(false);
        getPixiStub = sinon.stub(pixiModule, 'getPixi');
        getPixiStub.resolves(pixi);
        allowUvPythonInstall = undefined;
        sinon
            .stub(workspaceApis, 'getConfiguration')
            .returns({ get: () => allowUvPythonInstall } as unknown as WorkspaceConfiguration);
        autoSyncUvEnvStub = sinon.stub(autoCreateLockFileEnv, 'autoSyncUvEnv');
        autoSyncUvEnvStub.resolves(undefined);
        autoInstallPixiEnvStub = sinon.stub(autoCreateLockFileEnv, 'autoInstallPixiEnv');
        autoInstallPixiEnvStub.resolves(undefined);
        showPixiNotInstalledWarningStub = sinon.stub(autoCreateLockFileEnv, 'showPixiNotInstalledWarning');
        showPixiNotInstalledWarningStub.resolves(undefined);
        sinon.stub(commandApis, 'registerCommand').returns({ dispose: () => undefined });
        registerCreateEnvironmentTriggers([], pythonRuntimeManager);
        // --- End Positron ---
    });

    teardown(() => {
        sinon.restore();
    });

    test('No Uri', async () => {
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, undefined);
        sinon.assert.notCalled(shouldPromptToCreateEnvStub);
    });

    test('Should not perform checks if user set trigger to "off"', async () => {
        shouldPromptToCreateEnvStub.returns(false);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.notCalled(hasVenvStub);
        sinon.assert.notCalled(hasPrefixCondaEnvStub);
        sinon.assert.notCalled(hasRequirementFilesStub);
        sinon.assert.notCalled(hasKnownFilesStub);
        sinon.assert.notCalled(isGlobalPythonSelectedStub);
        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should not perform checks even if force is true, if user set trigger to "off"', async () => {
        shouldPromptToCreateEnvStub.returns(false);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri, {
            force: true,
        });

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.notCalled(hasVenvStub);
        sinon.assert.notCalled(hasPrefixCondaEnvStub);
        sinon.assert.notCalled(hasRequirementFilesStub);
        sinon.assert.notCalled(hasKnownFilesStub);
        sinon.assert.notCalled(isGlobalPythonSelectedStub);
        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should not show prompt if there is a ".venv"', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(true);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(true);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should not show prompt if there is a ".conda"', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(true);
        hasRequirementFilesStub.resolves(true);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should not show prompt if there are no requirements', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should not show prompt if there are known files', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(false);
        hasKnownFilesStub.resolves(true);
        isGlobalPythonSelectedStub.resolves(true);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should not show prompt if selected python is not global', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(true);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(false);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should show prompt if all conditions met: User closes prompt', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(true);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        showInformationMessageStub.resolves(undefined);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.calledOnce(showInformationMessageStub);

        // --- Start Positron ---
        sinon.assert.notCalled(autoCreateVenvWithDepsStub);
        // --- End Positron ---
        sinon.assert.notCalled(disableCreateEnvironmentTriggerStub);
    });

    test('Should show prompt if all conditions met: User clicks create', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(true);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);

        // --- Start Positron ---
        showInformationMessageStub.resolves(Common.bannerLabelYes);
        // --- End Positron ---
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.calledOnce(showInformationMessageStub);

        // --- Start Positron ---
        sinon.assert.calledOnce(autoCreateVenvWithDepsStub);
        // --- End Positron ---
        sinon.assert.notCalled(disableCreateEnvironmentTriggerStub);
    });

    test("Should show prompt if all conditions met: User clicks don't show again", async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(true);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);

        showInformationMessageStub.resolves(Common.doNotShowAgain);
        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnce(shouldPromptToCreateEnvStub);
        sinon.assert.calledOnce(hasVenvStub);
        sinon.assert.calledOnce(hasPrefixCondaEnvStub);
        sinon.assert.calledOnce(hasRequirementFilesStub);
        sinon.assert.calledOnce(hasKnownFilesStub);
        sinon.assert.calledOnce(isGlobalPythonSelectedStub);
        sinon.assert.calledOnce(showInformationMessageStub);

        // --- Start Positron ---
        sinon.assert.notCalled(autoCreateVenvWithDepsStub);
        // --- End Positron ---
        sinon.assert.calledOnce(disableCreateEnvironmentTriggerStub);
    });

    // --- Start Positron ---
    test('Does not show the notification when the interpreter-select modal already prompted', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(true);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        hasShownCreateEnvModalStub.returns(true);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('Should show uv sync prompt when uv.lock exists and no venv: user clicks create', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'uv.lock')).resolves(true);
        showInformationMessageStub.resolves(Common.bannerLabelYes);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnceWithExactly(
            showInformationMessageStub,
            CreateEnv.Trigger.uvSyncMessage,
            Common.bannerLabelYes,
            Common.notNow,
            Common.doNotShowAgain,
        );
        sinon.assert.calledOnceWithExactly(autoSyncUvEnvStub, workspace1, pythonRuntimeManager);
        sinon.assert.notCalled(autoCreateVenvWithDepsStub);
        sinon.assert.notCalled(autoInstallPixiEnvStub);
    });

    test('Should not show uv sync prompt when a venv already exists', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(true);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'uv.lock')).resolves(true);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(autoSyncUvEnvStub);
    });

    test('Should show pixi install prompt when pixi.lock exists and no pixi env: user clicks create', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'pixi.lock')).resolves(true);
        hasPixiEnvStub.resolves(false);
        showInformationMessageStub.resolves(Common.bannerLabelYes);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnceWithExactly(
            showInformationMessageStub,
            CreateEnv.Trigger.pixiInstallMessage,
            Common.bannerLabelYes,
            Common.notNow,
            Common.doNotShowAgain,
        );
        sinon.assert.calledOnceWithExactly(autoInstallPixiEnvStub, workspace1, pixi, pythonRuntimeManager);
        sinon.assert.notCalled(autoCreateVenvWithDepsStub);
        sinon.assert.notCalled(autoSyncUvEnvStub);
    });

    test('Should not show pixi install prompt when a pixi env already exists', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasRequirementFilesStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'pixi.lock')).resolves(true);
        hasPixiEnvStub.resolves(true);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(autoInstallPixiEnvStub);
    });

    test('pixi.lock presence suppresses the legacy pip-based prompt entirely', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'pixi.lock')).resolves(true);
        hasPixiEnvStub.resolves(true); // pixi branch skipped because a pixi env already exists
        hasRequirementFilesStub.resolves(true); // would otherwise satisfy the legacy trigger
        isGlobalPythonSelectedStub.resolves(true);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.notCalled(showInformationMessageStub);
    });

    test('With a runtime manager and no lock file, forwards it to the dependency-file create flow', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        hasRequirementFilesStub.resolves(true);
        isGlobalPythonSelectedStub.resolves(true);
        showInformationMessageStub.resolves(Common.bannerLabelYes);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.calledOnceWithExactly(
            autoCreateVenvWithDepsStub,
            sinon.match.any,
            sinon.match.any,
            undefined,
            pythonRuntimeManager,
        );
    });

    test('Should not show uv sync prompt when allowUvPythonInstall is off', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        hasRequirementFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'uv.lock')).resolves(true);
        allowUvPythonInstall = false;

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.notCalled(autoSyncUvEnvStub);
    });

    test('pixi.lock exists but pixi is not installed: shows the not-installed warning instead of the prompt', async () => {
        shouldPromptToCreateEnvStub.returns(true);
        hasVenvStub.resolves(false);
        hasPrefixCondaEnvStub.resolves(false);
        hasKnownFilesStub.resolves(false);
        isGlobalPythonSelectedStub.resolves(true);
        pathExistsStub.withArgs(path.join(workspace1.uri.fsPath, 'pixi.lock')).resolves(true);
        getPixiStub.resolves(undefined);

        await triggerCreateEnvironmentCheck(CreateEnvironmentCheckKind.Workspace, workspace1.uri);

        sinon.assert.notCalled(showInformationMessageStub);
        sinon.assert.calledOnce(showPixiNotInstalledWarningStub);
        sinon.assert.notCalled(autoInstallPixiEnvStub);
    });
    // --- End Positron ---
});
