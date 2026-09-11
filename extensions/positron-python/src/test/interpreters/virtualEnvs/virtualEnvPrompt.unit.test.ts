// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable } from 'vscode';
import { ApplicationShell } from '../../../client/common/application/applicationShell';
import { IApplicationShell } from '../../../client/common/application/types';
import { PersistentStateFactory } from '../../../client/common/persistentState';
import { IPersistentState, IPersistentStateFactory } from '../../../client/common/types';
import { Common, Interpreters } from '../../../client/common/utils/localize';
import { IComponentAdapter } from '../../../client/interpreter/contracts';
import { VirtualEnvironmentPrompt } from '../../../client/interpreter/virtualEnvs/virtualEnvPrompt';
import { IPythonRuntimeManager } from '../../../client/positron/manager';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import * as createEnvApi from '../../../client/pythonEnvironments/creation/createEnvApi';
import * as sessionModule from '../../../client/positron/session';
import * as telemetry from '../../../client/telemetry';
import { EventName } from '../../../client/telemetry/constants';

suite('Virtual Environment Prompt', () => {
    class VirtualEnvironmentPromptTest extends VirtualEnvironmentPrompt {
        public async handleNewEnvironment(envPath: string): Promise<void> {
            await super.handleNewEnvironment(envPath);
        }

        public async notifyUser(interpreter: PythonEnvironment): Promise<void> {
            await super.notifyUser(interpreter);
        }
    }

    const envPath = 'path/to/interpreter';
    const interpreter = { path: envPath, detailedDisplayName: 'Python 3.11' } as unknown as PythonEnvironment;
    const runtimeMetadata = {
        runtimeId: 'runtime-id',
        runtimeName: 'Python 3.11',
    } as unknown as positron.LanguageRuntimeMetadata;

    let persistentStateFactory: IPersistentStateFactory;
    let disposable: Disposable;
    let appShell: IApplicationShell;
    let componentAdapter: IComponentAdapter;
    let pythonRuntimeManager: IPythonRuntimeManager;
    let environmentPrompt: VirtualEnvironmentPromptTest;
    let isCreatingEnvironmentStub: sinon.SinonStub;
    let getActivePythonSessionsStub: sinon.SinonStub;
    let sendTelemetryEventStub: sinon.SinonStub;
    let startLanguageRuntimeStub: sinon.SinonStub;
    let notificationPromptEnabled: TypeMoq.IMock<IPersistentState<boolean>>;
    let originalStartLanguageRuntime: unknown;
    const prompts = [Interpreters.startSession, Common.notNow, Common.doNotShowAgain];

    setup(() => {
        persistentStateFactory = mock(PersistentStateFactory);
        componentAdapter = mock<IComponentAdapter>();
        pythonRuntimeManager = mock<IPythonRuntimeManager>();
        isCreatingEnvironmentStub = sinon.stub(createEnvApi, 'isCreatingEnvironment');
        isCreatingEnvironmentStub.returns(false);
        getActivePythonSessionsStub = sinon.stub(sessionModule, 'getActivePythonSessions');
        getActivePythonSessionsStub.resolves([]);
        sendTelemetryEventStub = sinon.stub(telemetry, 'sendTelemetryEvent');
        when(componentAdapter.getInterpreterDetails(envPath)).thenResolve(interpreter);
        disposable = mock(Disposable);
        appShell = mock(ApplicationShell);

        notificationPromptEnabled = TypeMoq.Mock.ofType<IPersistentState<boolean>>();
        notificationPromptEnabled.setup((n) => n.value).returns(() => true);
        when(persistentStateFactory.createWorkspacePersistentState(anything(), true)).thenReturn(
            notificationPromptEnabled.object,
        );

        when(pythonRuntimeManager.resolveRuntimeMetadataFromPath(envPath)).thenResolve(runtimeMetadata);

        // Stub this directly because ts-mockito cannot infer its overload.
        originalStartLanguageRuntime = (positron.runtime as { startLanguageRuntime?: unknown }).startLanguageRuntime;
        startLanguageRuntimeStub = sinon.stub().resolves(undefined);
        Object.assign(positron.runtime, { startLanguageRuntime: startLanguageRuntimeStub });

        environmentPrompt = new VirtualEnvironmentPromptTest(
            instance(persistentStateFactory),
            [instance(disposable)],
            instance(appShell),
            instance(componentAdapter),
            instance(pythonRuntimeManager),
        );
    });

    teardown(() => {
        sinon.restore();
        if (originalStartLanguageRuntime === undefined) {
            delete (positron.runtime as { startLanguageRuntime?: unknown }).startLanguageRuntime;
        } else {
            Object.assign(positron.runtime, { startLanguageRuntime: originalStartLanguageRuntime });
        }
    });

    function fakeSession(pythonPath: string, state: positron.RuntimeState): sessionModule.PythonRuntimeSession {
        return {
            getRuntimeState: () => state,
            runtimeMetadata: { extraRuntimeData: { pythonPath } },
        } as unknown as sessionModule.PythonRuntimeSession;
    }

    test('If environment is being created, no notification is shown', async () => {
        isCreatingEnvironmentStub.returns(true);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(appShell.showInformationMessage(anything(), ...prompts)).never();
    });

    test('If a matching non-exited session already exists, no notification is shown', async () => {
        getActivePythonSessionsStub.resolves([fakeSession(envPath, positron.RuntimeState.Idle)]);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(appShell.showInformationMessage(anything(), ...prompts)).never();
    });

    test('If a matching session has exited, notification is shown', async () => {
        getActivePythonSessionsStub.resolves([fakeSession(envPath, positron.RuntimeState.Exited)]);
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve();

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(appShell.showInformationMessage(anything(), ...prompts)).once();
    });

    test('If a session exists for a different path, notification is shown', async () => {
        getActivePythonSessionsStub.resolves([fakeSession('path/to/other', positron.RuntimeState.Idle)]);
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve();

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(appShell.showInformationMessage(anything(), ...prompts)).once();
    });

    test('If getInterpreterDetails returns undefined, no notification is shown', async () => {
        when(componentAdapter.getInterpreterDetails(envPath)).thenResolve(undefined);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(appShell.showInformationMessage(anything(), ...prompts)).never();
    });

    test('If the workspace preference is disabled, no notification is shown', async () => {
        notificationPromptEnabled.reset();
        notificationPromptEnabled.setup((n) => n.value).returns(() => false);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(appShell.showInformationMessage(anything(), ...prompts)).never();
    });

    test('Notification shows the new session message and the three expected labels', async () => {
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve();

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(appShell.showInformationMessage(Interpreters.environmentSessionPromptMessage, ...prompts)).once();
    });

    test("'Start Session' re-checks sessions and returns if one now exists", async () => {
        // Simulate a session starting while the notification is open.
        getActivePythonSessionsStub.onFirstCall().resolves([]);
        getActivePythonSessionsStub.onSecondCall().resolves([fakeSession(envPath, positron.RuntimeState.Idle)]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(prompts[0] as any);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(pythonRuntimeManager.resolveRuntimeMetadataFromPath(envPath)).never();
    });

    test("'Start Session' calls resolveRuntimeMetadataFromPath then startLanguageRuntime with the returned id and name", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(prompts[0] as any);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(pythonRuntimeManager.resolveRuntimeMetadataFromPath(envPath)).once();
        sinon.assert.calledOnceWithExactly(
            startLanguageRuntimeStub,
            runtimeMetadata.runtimeId,
            runtimeMetadata.runtimeName,
        );
    });

    test('If resolveRuntimeMetadataFromPath returns undefined, an error message is shown and startLanguageRuntime is not called', async () => {
        when(pythonRuntimeManager.resolveRuntimeMetadataFromPath(envPath)).thenResolve(undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(prompts[0] as any);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(
            appShell.showErrorMessage(
                Interpreters.environmentSessionStartFailed(interpreter.detailedDisplayName ?? interpreter.path),
            ),
        ).once();
        sinon.assert.notCalled(startLanguageRuntimeStub);
    });

    test('If startLanguageRuntime rejects, an error message is shown once', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(prompts[0] as any);
        startLanguageRuntimeStub.rejects(new Error('boom'));

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(
            appShell.showErrorMessage(
                Interpreters.environmentSessionStartFailed(interpreter.detailedDisplayName ?? interpreter.path),
            ),
        ).once();
    });

    test("If user selects 'Not Now', no side effects occur", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(prompts[1] as any);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(pythonRuntimeManager.resolveRuntimeMetadataFromPath(envPath)).never();
        notificationPromptEnabled.verify((n) => n.updateValue(false), TypeMoq.Times.never());
    });

    test('If the prompt is dismissed, no side effects occur', async () => {
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(undefined);

        await environmentPrompt.handleNewEnvironment(envPath);

        verify(pythonRuntimeManager.resolveRuntimeMetadataFromPath(envPath)).never();
        notificationPromptEnabled.verify((n) => n.updateValue(false), TypeMoq.Times.never());
    });

    test("If user selects 'Don't Show Again', the workspace preference is set to false", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(prompts[2] as any);
        notificationPromptEnabled
            .setup((n) => n.updateValue(false))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.once());

        await environmentPrompt.handleNewEnvironment(envPath);

        notificationPromptEnabled.verifyAll();
    });

    test('Telemetry selections stay Yes, No, Ignore', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showInformationMessage(anything(), ...prompts)).thenResolve(prompts[1] as any);

        await environmentPrompt.handleNewEnvironment(envPath);

        sinon.assert.calledOnceWithExactly(
            sendTelemetryEventStub,
            EventName.PYTHON_INTERPRETER_ACTIVATE_ENVIRONMENT_PROMPT,
            undefined,
            { selection: 'No' },
        );
    });
});
