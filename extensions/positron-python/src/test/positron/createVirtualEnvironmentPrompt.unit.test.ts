/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import { assert } from 'chai';
import { Uri, WorkspaceFolder } from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as typemoq from 'typemoq';
import * as positronCreateEnvApi from '../../client/positron/createEnvApi';
import * as workspaceApis from '../../client/common/vscodeApis/workspaceApis';
import * as commandApis from '../../client/common/vscodeApis/commandApis';
import * as positronApis from '../../client/positron/positronApis';
import * as persistentState from '../../client/common/persistentState';
import * as externallyManaged from '../../client/positron/externallyManagedEnvironment';
import * as interpreterSettings from '../../client/positron/interpreterSettings';
import * as triggerUtils from '../../client/pythonEnvironments/creation/common/createEnvTriggerUtils';
import * as uv from '../../client/pythonEnvironments/common/environmentManagers/uv';
import * as autoCreateVenv from '../../client/pythonEnvironments/creation/provider/autoCreateVenv';
import * as globalEnvironment from '../../client/pythonEnvironments/common/environmentManagers/globalEnvironment';
import * as uvPythonInstaller from '../../client/pythonEnvironments/common/environmentManagers/uvPythonInstaller';
import {
    CreateEnvironmentLadderInput,
    CreateVirtualEnvironmentPromptOutcome,
    chooseCreateEnvironmentOptions,
    promptToCreateVirtualEnvironment,
} from '../../client/positron/createVirtualEnvironmentPrompt';
import { CONDA_PROVIDER_ID } from '../../client/pythonEnvironments/creation/provider/condaCreationProvider';
import { UV_PROVIDER_ID } from '../../client/pythonEnvironments/creation/provider/uvCreationProvider';
import { VenvCreationProviderId } from '../../client/pythonEnvironments/creation/provider/venvCreationProvider';
import { Commands } from '../../client/common/constants';
import { CreateEnv, GlobalEnvironment } from '../../client/common/utils/localize';
import { IExtensionContext } from '../../client/common/types';
import { IPythonRuntimeManager } from '../../client/positron/manager';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';
import { Architecture } from '../../client/common/utils/platform';
import { createTypeMoq } from '../mocks/helper';

suite('Create virtual environment prompt - provider ladder', () => {
    const workspaceFolder: WorkspaceFolder = {
        uri: Uri.file('/work/project'),
        name: 'project',
        index: 0,
    };
    let isEnvProviderEnabledStub: sinon.SinonStub;

    function makeInput(overrides: Partial<CreateEnvironmentLadderInput> = {}): CreateEnvironmentLadderInput {
        return {
            interpreterPath: '/usr/bin/python3',
            versionMajorMinor: '3.12',
            isCondaBase: false,
            uvInstalled: false,
            allowUvPythonInstall: true,
            workspaceFolder,
            ...overrides,
        };
    }

    setup(() => {
        isEnvProviderEnabledStub = sinon.stub(positronCreateEnvApi, 'isEnvProviderEnabled').returns(true);
    });

    teardown(() => {
        sinon.restore();
    });

    test('uses the conda provider for a conda base interpreter', () => {
        const options = chooseCreateEnvironmentOptions(makeInput({ isCondaBase: true, uvInstalled: true }));

        assert.deepStrictEqual(options, {
            workspaceFolder,
            providerId: CONDA_PROVIDER_ID,
            condaPythonVersion: '3.12',
        });
    });

    test('uses the uv provider when uv is installed and Python installs are allowed', () => {
        const options = chooseCreateEnvironmentOptions(makeInput({ uvInstalled: true }));

        assert.deepStrictEqual(options, {
            workspaceFolder,
            providerId: UV_PROVIDER_ID,
            uvPythonVersion: '3.12',
        });
    });

    test('falls through to venv when python.allowUvPythonInstall is off', () => {
        const options = chooseCreateEnvironmentOptions(makeInput({ uvInstalled: true, allowUvPythonInstall: false }));

        assert.deepStrictEqual(options, {
            workspaceFolder,
            providerId: VenvCreationProviderId,
            interpreterPath: '/usr/bin/python3',
        });
    });

    test('falls through to venv when the uv provider is disabled', () => {
        isEnvProviderEnabledStub.withArgs(UV_PROVIDER_ID).returns(false);

        const options = chooseCreateEnvironmentOptions(makeInput({ uvInstalled: true }));

        assert.deepStrictEqual(options, {
            workspaceFolder,
            providerId: VenvCreationProviderId,
            interpreterPath: '/usr/bin/python3',
        });
    });

    test('falls through to venv when the interpreter version is unknown', () => {
        const options = chooseCreateEnvironmentOptions(
            makeInput({ isCondaBase: true, uvInstalled: true, versionMajorMinor: undefined }),
        );

        assert.deepStrictEqual(options, {
            workspaceFolder,
            providerId: VenvCreationProviderId,
            interpreterPath: '/usr/bin/python3',
        });
    });

    test('omits the workspace folder in a multi-root workspace', () => {
        const options = chooseCreateEnvironmentOptions(makeInput({ workspaceFolder: undefined }));

        assert.deepStrictEqual(options, {
            providerId: VenvCreationProviderId,
            interpreterPath: '/usr/bin/python3',
        });
    });

    test('returns undefined when every provider is disabled', () => {
        isEnvProviderEnabledStub.returns(false);

        const options = chooseCreateEnvironmentOptions(makeInput({ isCondaBase: true, uvInstalled: true }));

        assert.strictEqual(options, undefined);
    });
});

suite('Create virtual environment prompt - gate', () => {
    const interpreterPath = '/usr/bin/python3';
    const workspaceFolder: WorkspaceFolder = { uri: Uri.file('/work/project'), name: 'project', index: 0 };
    const environment = {
        path: interpreterPath,
        architecture: Architecture.x64,
        sysPrefix: '/usr',
        version: { major: 3, minor: 12, patch: 3, raw: '3.12.3' },
        envType: EnvironmentType.System,
        displayName: 'Python 3.12.3 (System)',
    } as PythonEnvironment;

    let serviceContainer: typemoq.IMock<IServiceContainer>;
    let interpreterService: typemoq.IMock<IInterpreterService>;
    let runtimeManager: typemoq.IMock<IPythonRuntimeManager>;
    let pythonConfig: typemoq.IMock<import('vscode').WorkspaceConfiguration>;
    let suppressedPaths: string[];
    let setSuppressedPaths: sinon.SinonStub;
    let showPromptStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;
    let probeStub: sinon.SinonStub;
    let autoCreateVenvWithDepsStub: sinon.SinonStub;

    function consoleMetadata(userSelected: boolean | undefined): positron.RuntimeSessionMetadata {
        return {
            sessionId: 'session-id',
            sessionMode: positron.LanguageRuntimeSessionMode.Console,
            userSelected,
        } as positron.RuntimeSessionMetadata;
    }

    function run(metadata = consoleMetadata(true)) {
        return promptToCreateVirtualEnvironment(
            serviceContainer.object,
            interpreterService.object,
            runtimeManager.object,
            interpreterPath,
            metadata,
        );
    }

    setup(() => {
        serviceContainer = createTypeMoq<IServiceContainer>();
        interpreterService = createTypeMoq<IInterpreterService>();
        const context = createTypeMoq<IExtensionContext>();
        serviceContainer.setup((s) => s.get(IExtensionContext)).returns(() => context.object);

        runtimeManager = createTypeMoq<IPythonRuntimeManager>();
        runtimeManager
            .setup((m) => m.selectLanguageRuntimeFromPath(typemoq.It.isAnyString(), typemoq.It.isAny()))
            .returns(() => Promise.resolve('runtime-id'));

        pythonConfig = createTypeMoq<import('vscode').WorkspaceConfiguration>();
        pythonConfig.setup((c) => c.get('createEnvironment.promptOnInterpreterSelect')).returns(() => true);
        pythonConfig.setup((c) => c.get('allowUvPythonInstall')).returns(() => true);
        sinon.stub(workspaceApis, 'getConfiguration').returns(pythonConfig.object);
        sinon.stub(workspaceApis, 'getWorkspaceFolders').returns([workspaceFolder]);

        suppressedPaths = [];
        setSuppressedPaths = sinon.stub().resolves();
        sinon.stub(persistentState, 'getGlobalStorage').returns({
            get: () => suppressedPaths,
            set: setSuppressedPaths,
        });

        probeStub = sinon
            .stub(externallyManaged, 'probeExternallyManagedEnvironment')
            .resolves({ externallyManaged: true, environment });
        sinon.stub(triggerUtils, 'markCreateEnvModalShown');
        sinon.stub(triggerUtils, 'clearCreateEnvModalShown');
        sinon.stub(positronCreateEnvApi, 'isEnvProviderEnabled').returns(true);
        sinon.stub(uv, 'isUvInstalled').resolves(false);
        autoCreateVenvWithDepsStub = sinon.stub(autoCreateVenv, 'autoCreateVenvWithDeps').resolves(undefined);
        sinon
            .stub(autoCreateVenv, 'detectAutoCreateContext')
            .resolves({ hasRequirements: false, hasPyprojectToml: false, uvAvailable: false });
        showPromptStub = sinon.stub(positronApis, 'showThreeButtonModalDialogPrompt').resolves(undefined);
        executeCommandStub = sinon.stub(commandApis, 'executeCommand').resolves(undefined);
    });

    teardown(() => {
        sinon.restore();
    });

    test('shows the modal with all three buttons for an externally-managed console pick', async () => {
        await run();

        assert.deepStrictEqual(showPromptStub.firstCall.args, [
            {
                title: CreateEnv.InterpreterSelect.title,
                message: CreateEnv.InterpreterSelect.message('Python 3.12.3 (System)'),
                primaryButtonTitle: CreateEnv.InterpreterSelect.createEnvironment,
                secondaryButtonTitle: CreateEnv.InterpreterSelect.notNow,
                tertiaryButtonTitle: CreateEnv.InterpreterSelect.neverForThisInterpreter,
            },
        ]);
    });

    test('Create Environment invokes the create flow and aborts the session start', async () => {
        showPromptStub.resolves(CreateEnv.InterpreterSelect.createEnvironment);

        const outcome = await run();

        assert.deepStrictEqual(
            {
                outcome,
                command: executeCommandStub.firstCall?.args[0],
                options: executeCommandStub.firstCall?.args[1],
            },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Abort,
                command: Commands.Create_Environment,
                options: {
                    workspaceFolder,
                    providerId: VenvCreationProviderId,
                    interpreterPath,
                },
            },
        );
    });

    test('Create Environment uses the dependency-aware flow when the workspace has dependency files', async () => {
        (autoCreateVenv.detectAutoCreateContext as sinon.SinonStub).resolves({
            hasRequirements: true,
            hasPyprojectToml: false,
            uvAvailable: true,
        });
        showPromptStub.resolves(CreateEnv.InterpreterSelect.createEnvironment);

        const outcome = await run();

        assert.deepStrictEqual(
            {
                outcome,
                autoCreateCalls: autoCreateVenvWithDepsStub.callCount,
                commandCalls: executeCommandStub.callCount,
                forwardedOptions: autoCreateVenvWithDepsStub.firstCall?.args[2],
            },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Abort,
                autoCreateCalls: 1,
                commandCalls: 0,
                forwardedOptions: {
                    workspaceFolder,
                    providerId: VenvCreationProviderId,
                    interpreterPath,
                },
            },
        );
    });

    test('Not Now proceeds and records nothing', async () => {
        showPromptStub.resolves(CreateEnv.InterpreterSelect.notNow);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, suppressionWrites: setSuppressedPaths.callCount, commandCalls: executeCommandStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, suppressionWrites: 0, commandCalls: 0 },
        );
    });

    test('Never for This Interpreter records only the picked interpreter and proceeds', async () => {
        suppressedPaths = ['/opt/other/bin/python3'];
        showPromptStub.resolves(CreateEnv.InterpreterSelect.neverForThisInterpreter);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, written: setSuppressedPaths.firstCall.args[0] },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                written: ['/opt/other/bin/python3', interpreterPath],
            },
        );
    });

    test('Dismissing the dialog aborts the session start without creating anything', async () => {
        showPromptStub.resolves(undefined);

        const outcome = await run();

        assert.deepStrictEqual(
            {
                outcome,
                commandCalls: executeCommandStub.callCount,
                autoCreateCalls: autoCreateVenvWithDepsStub.callCount,
            },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Abort, commandCalls: 0, autoCreateCalls: 0 },
        );
    });

    test('Dismissing the dialog frees the startup notification to ask again', async () => {
        showPromptStub.resolves(undefined);

        await run();

        assert.deepStrictEqual(
            {
                marked: (triggerUtils.markCreateEnvModalShown as sinon.SinonStub).callCount,
                cleared: (triggerUtils.clearCreateEnvModalShown as sinon.SinonStub).callCount,
            },
            { marked: 1, cleared: 1 },
        );
    });

    test('Not Now does not suppress the modal for a later pick', async () => {
        showPromptStub.resolves(CreateEnv.InterpreterSelect.notNow);

        const first = await run();
        const second = await run();

        assert.deepStrictEqual(
            { first, second, shown: showPromptStub.callCount },
            {
                first: CreateVirtualEnvironmentPromptOutcome.Proceed,
                second: CreateVirtualEnvironmentPromptOutcome.Proceed,
                shown: 2,
            },
        );
    });

    test('skips the modal for notebook sessions', async () => {
        const outcome = await run({
            sessionId: 'session-id',
            sessionMode: positron.LanguageRuntimeSessionMode.Notebook,
            userSelected: true,
        } as positron.RuntimeSessionMetadata);

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when the session was not user selected', async () => {
        const outcome = await run(consoleMetadata(undefined));

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when the setting is off', async () => {
        pythonConfig.reset();
        pythonConfig.setup((c) => c.get('createEnvironment.promptOnInterpreterSelect')).returns(() => false);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount, probed: probeStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0, probed: 0 },
        );
    });

    test('skips the modal when the interpreter is suppressed', async () => {
        suppressedPaths = [interpreterPath];

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when the interpreter is not externally managed', async () => {
        probeStub.resolves({ externallyManaged: false, environment });

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when every environment provider is disabled', async () => {
        (positronCreateEnvApi.isEnvProviderEnabled as sinon.SinonStub).returns(false);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('stands the startup notification down once the modal is answered', async () => {
        showPromptStub.resolves(CreateEnv.InterpreterSelect.notNow);

        await run();

        assert.deepStrictEqual(
            {
                marked: (triggerUtils.markCreateEnvModalShown as sinon.SinonStub).callCount,
                cleared: (triggerUtils.clearCreateEnvModalShown as sinon.SinonStub).callCount,
            },
            { marked: 1, cleared: 0 },
        );
    });
});

suite('Create virtual environment prompt - no workspace', () => {
    const interpreterPath = '/usr/bin/python3';
    const venvDir = '/home/user/.virtualenvs/positron';
    const environment = {
        path: interpreterPath,
        architecture: Architecture.x64,
        sysPrefix: '/usr',
        version: { major: 3, minor: 12, patch: 3, raw: '3.12.3' },
        envType: EnvironmentType.System,
        displayName: 'Python 3.12.3 (System)',
    } as PythonEnvironment;

    let serviceContainer: typemoq.IMock<IServiceContainer>;
    let interpreterService: typemoq.IMock<IInterpreterService>;
    let runtimeManager: typemoq.IMock<IPythonRuntimeManager>;
    let registeredRuntimes: (positron.LanguageRuntimeMetadata | undefined)[];
    let selectLanguageRuntimeFromPath: () => Promise<string | undefined>;
    let pythonConfig: typemoq.IMock<import('vscode').WorkspaceConfiguration>;
    let suppressedPaths: string[];
    let setSuppressedPaths: sinon.SinonStub;
    let showPromptStub: sinon.SinonStub;
    let probeStub: sinon.SinonStub;
    let isUvInstalledStub: sinon.SinonStub;
    let getGlobalEnvironmentDirStub: sinon.SinonStub;
    let createGlobalEnvironmentStub: sinon.SinonStub;
    let showUvInstallErrorStub: sinon.SinonStub;
    let shouldIncludeInterpreterStub: sinon.SinonStub;

    function run(metadata?: positron.RuntimeSessionMetadata) {
        return promptToCreateVirtualEnvironment(
            serviceContainer.object,
            interpreterService.object,
            runtimeManager.object,
            interpreterPath,
            metadata ??
                ({
                    sessionId: 'session-id',
                    sessionMode: positron.LanguageRuntimeSessionMode.Console,
                    userSelected: true,
                } as positron.RuntimeSessionMetadata),
        );
    }

    setup(() => {
        serviceContainer = createTypeMoq<IServiceContainer>();
        interpreterService = createTypeMoq<IInterpreterService>();
        const context = createTypeMoq<IExtensionContext>();
        serviceContainer.setup((s) => s.get(IExtensionContext)).returns(() => context.object);

        runtimeManager = createTypeMoq<IPythonRuntimeManager>();
        selectLanguageRuntimeFromPath = () => Promise.resolve('runtime-id');
        runtimeManager
            .setup((m) => m.selectLanguageRuntimeFromPath(typemoq.It.isAnyString(), typemoq.It.isAny()))
            .returns(() => selectLanguageRuntimeFromPath());
        registeredRuntimes = [{ runtimeId: 'runtime-id' } as positron.LanguageRuntimeMetadata];
        runtimeManager
            .setup((m) => m.registerLanguageRuntimeFromPath(typemoq.It.isAnyString(), typemoq.It.isAny()))
            .returns(() => Promise.resolve(registeredRuntimes.shift()));
        runtimeManager.setup((m) => m.triggerInterpreterRefresh()).returns(() => Promise.resolve());

        pythonConfig = createTypeMoq<import('vscode').WorkspaceConfiguration>();
        pythonConfig.setup((c) => c.get('createEnvironment.promptOnInterpreterSelect')).returns(() => true);
        pythonConfig.setup((c) => c.get('allowUvPythonInstall')).returns(() => true);
        sinon.stub(workspaceApis, 'getConfiguration').returns(pythonConfig.object);
        sinon.stub(workspaceApis, 'getWorkspaceFolders').returns(undefined);

        suppressedPaths = [];
        setSuppressedPaths = sinon.stub().resolves();
        sinon.stub(persistentState, 'getGlobalStorage').returns({
            get: () => suppressedPaths,
            set: setSuppressedPaths,
        });

        probeStub = sinon
            .stub(externallyManaged, 'probeExternallyManagedEnvironment')
            .resolves({ externallyManaged: true, environment });
        sinon.stub(triggerUtils, 'markCreateEnvModalShown');
        sinon.stub(triggerUtils, 'clearCreateEnvModalShown');
        sinon.stub(positronCreateEnvApi, 'isEnvProviderEnabled').returns(true);
        isUvInstalledStub = sinon.stub(uv, 'isUvInstalled').resolves(true);
        getGlobalEnvironmentDirStub = sinon.stub(globalEnvironment, 'getGlobalEnvironmentDir').returns(venvDir);
        shouldIncludeInterpreterStub = sinon.stub(interpreterSettings, 'shouldIncludeInterpreter').returns(true);
        createGlobalEnvironmentStub = sinon.stub(globalEnvironment, 'createGlobalEnvironment').resolves({
            outcome: 'created',
            venvDir,
            pythonPath: `${venvDir}/bin/python`,
        });
        showUvInstallErrorStub = sinon.stub(uvPythonInstaller, 'showUvInstallError').resolves();
        showPromptStub = sinon.stub(positronApis, 'showThreeButtonModalDialogPrompt').resolves(undefined);
        sinon.stub(commandApis, 'executeCommand').resolves(undefined);
    });

    teardown(() => {
        sinon.restore();
    });

    test('shows the global-environment modal without an Open Folder button', async () => {
        await run();

        assert.deepStrictEqual(showPromptStub.firstCall.args, [
            {
                title: GlobalEnvironment.sessionPromptTitle,
                message: GlobalEnvironment.sessionPromptMessage('Python 3.12.3 (System)', venvDir),
                primaryButtonTitle: GlobalEnvironment.createButton,
                secondaryButtonTitle: GlobalEnvironment.notNow,
                tertiaryButtonTitle: CreateEnv.InterpreterSelect.neverForThisInterpreter,
            },
        ]);
    });

    test('Not Now starts the session on the picked interpreter', async () => {
        showPromptStub.resolves(GlobalEnvironment.notNow);

        const outcome = await run();

        assert.deepStrictEqual(
            {
                outcome,
                created: createGlobalEnvironmentStub.callCount,
                suppressionWrites: setSuppressedPaths.callCount,
            },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, created: 0, suppressionWrites: 0 },
        );
    });

    test('Never for This Interpreter suppresses and starts the session', async () => {
        suppressedPaths = ['/opt/other/bin/python3'];
        showPromptStub.resolves(CreateEnv.InterpreterSelect.neverForThisInterpreter);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, written: setSuppressedPaths.firstCall.args[0] },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                written: ['/opt/other/bin/python3', interpreterPath],
            },
        );
    });

    test('Dismissing the dialog starts the session and frees the startup notification', async () => {
        showPromptStub.resolves(undefined);

        const outcome = await run();

        assert.deepStrictEqual(
            {
                outcome,
                created: createGlobalEnvironmentStub.callCount,
                marked: (triggerUtils.markCreateEnvModalShown as sinon.SinonStub).callCount,
                cleared: (triggerUtils.clearCreateEnvModalShown as sinon.SinonStub).callCount,
            },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, created: 0, marked: 1, cleared: 1 },
        );
    });

    test('Not Now leaves the once-per-window flag marked', async () => {
        showPromptStub.resolves(GlobalEnvironment.notNow);

        await run();

        assert.deepStrictEqual(
            {
                marked: (triggerUtils.markCreateEnvModalShown as sinon.SinonStub).callCount,
                cleared: (triggerUtils.clearCreateEnvModalShown as sinon.SinonStub).callCount,
            },
            { marked: 1, cleared: 0 },
        );
    });

    test('skips the modal when there is nowhere to put the global environment', async () => {
        getGlobalEnvironmentDirStub.returns(undefined);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when user settings exclude the global environment path', async () => {
        shouldIncludeInterpreterStub.returns(false);

        const outcome = await run();

        assert.deepStrictEqual(
            {
                outcome,
                shown: showPromptStub.callCount,
                checked: shouldIncludeInterpreterStub.firstCall.args[0],
            },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                shown: 0,
                checked: globalEnvironment.getGlobalEnvironmentPython(venvDir),
            },
        );
    });

    test('skips the modal when uv is not installed', async () => {
        isUvInstalledStub.resolves(false);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when the uv provider is disabled', async () => {
        (positronCreateEnvApi.isEnvProviderEnabled as sinon.SinonStub).withArgs(UV_PROVIDER_ID).returns(false);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when the setting is off', async () => {
        pythonConfig.reset();
        pythonConfig.setup((c) => c.get('createEnvironment.promptOnInterpreterSelect')).returns(() => false);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount, probed: probeStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0, probed: 0 },
        );
    });

    test('skips the modal when the interpreter is suppressed', async () => {
        suppressedPaths = [interpreterPath];

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when the interpreter is not externally managed', async () => {
        probeStub.resolves({ externallyManaged: false, environment });

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal for notebook sessions', async () => {
        const outcome = await run({
            sessionId: 'session-id',
            sessionMode: positron.LanguageRuntimeSessionMode.Notebook,
            userSelected: true,
        } as positron.RuntimeSessionMetadata);

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('skips the modal when the session was not user selected', async () => {
        const outcome = await run({
            sessionId: 'session-id',
            sessionMode: positron.LanguageRuntimeSessionMode.Console,
            userSelected: undefined,
        } as positron.RuntimeSessionMetadata);

        assert.deepStrictEqual(
            { outcome, shown: showPromptStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Proceed, shown: 0 },
        );
    });

    test('Create Global Environment builds from the picked interpreter and aborts the pending start', async () => {
        showPromptStub.resolves(GlobalEnvironment.createButton);

        const outcome = await run();

        runtimeManager.verify(
            (m) => m.registerLanguageRuntimeFromPath(`${venvDir}/bin/python`, true),
            typemoq.Times.once(),
        );
        runtimeManager.verify(
            (m) => m.selectLanguageRuntimeFromPath(`${venvDir}/bin/python`, typemoq.It.isAny()),
            typemoq.Times.once(),
        );
        assert.deepStrictEqual(
            {
                outcome,
                base: createGlobalEnvironmentStub.firstCall.args[0],
                errorsShown: showUvInstallErrorStub.callCount,
            },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Abort, base: interpreterPath, errorsShown: 0 },
        );
    });

    test('a runtime that is not registered yet is retried behind an interpreter refresh', async () => {
        showPromptStub.resolves(GlobalEnvironment.createButton);
        registeredRuntimes = [undefined, { runtimeId: 'runtime-id' } as positron.LanguageRuntimeMetadata];

        const outcome = await run();

        runtimeManager.verify((m) => m.triggerInterpreterRefresh(), typemoq.Times.once());
        runtimeManager.verify(
            (m) => m.selectLanguageRuntimeFromPath(`${venvDir}/bin/python`, typemoq.It.isAny()),
            typemoq.Times.once(),
        );
        assert.deepStrictEqual(
            { outcome, errorsShown: showUvInstallErrorStub.callCount },
            { outcome: CreateVirtualEnvironmentPromptOutcome.Abort, errorsShown: 0 },
        );
    });

    test('a selection that never starts shows the error and starts the picked interpreter', async () => {
        showPromptStub.resolves(GlobalEnvironment.createButton);
        selectLanguageRuntimeFromPath = () => Promise.resolve(undefined);

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, error: showUvInstallErrorStub.firstCall.args[0] },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                error: GlobalEnvironment.registrationFailed(`${venvDir}/bin/python`),
            },
        );
    });

    test('a selection that throws shows the error and starts the picked interpreter', async () => {
        showPromptStub.resolves(GlobalEnvironment.createButton);
        selectLanguageRuntimeFromPath = () => Promise.reject(new Error('boom'));

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, error: showUvInstallErrorStub.firstCall.args[0] },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                error: GlobalEnvironment.registrationFailed(`${venvDir}/bin/python`),
            },
        );
    });

    test('a runtime that never registers shows the error and starts the picked interpreter', async () => {
        showPromptStub.resolves(GlobalEnvironment.createButton);
        registeredRuntimes = [];

        const outcome = await run();

        runtimeManager.verify(
            (m) => m.selectLanguageRuntimeFromPath(typemoq.It.isAnyString(), typemoq.It.isAny()),
            typemoq.Times.never(),
        );
        assert.deepStrictEqual(
            { outcome, error: showUvInstallErrorStub.firstCall.args[0] },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                error: GlobalEnvironment.registrationFailed(`${venvDir}/bin/python`),
            },
        );
    });

    test('an occupied global path shows the error and starts the session on the picked interpreter', async () => {
        showPromptStub.resolves(GlobalEnvironment.createButton);
        createGlobalEnvironmentStub.resolves({ outcome: 'occupied', venvDir });

        const outcome = await run();

        runtimeManager.verify(
            (m) => m.selectLanguageRuntimeFromPath(typemoq.It.isAnyString(), typemoq.It.isAny()),
            typemoq.Times.never(),
        );
        assert.deepStrictEqual(
            { outcome, error: showUvInstallErrorStub.firstCall.args[0] },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                error: GlobalEnvironment.occupied(venvDir),
            },
        );
    });

    test('a failed creation shows the error and starts the session on the picked interpreter', async () => {
        showPromptStub.resolves(GlobalEnvironment.createButton);
        createGlobalEnvironmentStub.resolves({ outcome: 'failed', venvDir });

        const outcome = await run();

        assert.deepStrictEqual(
            { outcome, error: showUvInstallErrorStub.firstCall.args[0] },
            {
                outcome: CreateVirtualEnvironmentPromptOutcome.Proceed,
                error: GlobalEnvironment.creationFailed(venvDir),
            },
        );
    });
});
