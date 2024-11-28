/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { LanguageService } from 'vs/editor/common/services/languageService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { MockKeybindingService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { LanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronModalDialogsService } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';
import { RuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSession';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { TestOpenerService, TestPositronModalDialogService, TestCommandService, TestRuntimeSessionManager } from 'vs/workbench/test/common/positronWorkbenchTestServices';
import { TestExtensionService, TestStorageService, TestWorkspaceTrustManagementService } from 'vs/workbench/test/common/workbenchTestServices';

export function createRuntimeServices(
	instantiationService: TestInstantiationService,
	disposables: Pick<DisposableStore, 'add'> = new DisposableStore,
): TestInstantiationService {
	instantiationService.stub(IOpenerService, new TestOpenerService());
	instantiationService.stub(ILanguageService, disposables.add(new LanguageService()));
	instantiationService.stub(IExtensionService, new TestExtensionService());
	instantiationService.stub(IStorageService, disposables.add(new TestStorageService()));
	instantiationService.stub(ILogService, new NullLogService());
	instantiationService.stub(IWorkspaceTrustManagementService, disposables.add(new TestWorkspaceTrustManagementService()));
	instantiationService.stub(ILanguageRuntimeService, disposables.add(instantiationService.createInstance(LanguageRuntimeService)));
	instantiationService.stub(IPositronModalDialogsService, new TestPositronModalDialogService());
	instantiationService.stub(IConfigurationService, new TestConfigurationService());
	instantiationService.stub(ICommandService, new TestCommandService(instantiationService));
	instantiationService.stub(IKeybindingService, new MockKeybindingService());
	instantiationService.stub(IRuntimeSessionService, disposables.add(instantiationService.createInstance(RuntimeSessionService)));
	return instantiationService;
}

export function createTestLanguageRuntimeMetadata(
	instantiationService: TestInstantiationService,
	disposables: Pick<DisposableStore, 'add'>,
): ILanguageRuntimeMetadata {
	const languageRuntimeService = instantiationService.get(ILanguageRuntimeService);
	const runtimeSessionService = instantiationService.get(IRuntimeSessionService);

	// Register the test runtime.
	const languageName = 'Test';
	const languageVersion = '0.0.1';
	const runtime = {
		extensionId: new ExtensionIdentifier('test-extension'),
		base64EncodedIconSvg: '',
		extraRuntimeData: {},
		languageId: 'test',
		languageName,
		languageVersion,
		runtimeId: generateUuid(),
		runtimeName: `${languageName} ${languageVersion}`,
		runtimePath: '/test',
		runtimeShortName: languageVersion,
		runtimeSource: 'Test',
		runtimeVersion: '0.0.1',
		sessionLocation: LanguageRuntimeSessionLocation.Browser,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
	};
	disposables.add(languageRuntimeService.registerRuntime(runtime));

	// Register the test runtime manager.
	const manager = TestRuntimeSessionManager.instance;
	disposables.add(runtimeSessionService.registerSessionManager(manager));

	return runtime;
}

export interface IStartTestLanguageRuntimeSessionOptions {
	runtime?: ILanguageRuntimeMetadata;
	sessionName?: string;
	sessionMode?: LanguageRuntimeSessionMode;
	notebookUri?: URI;
	startReason?: string;
}

export async function startTestLanguageRuntimeSession(
	instantiationService: TestInstantiationService,
	disposables: Pick<DisposableStore, 'add'>,
	options?: IStartTestLanguageRuntimeSessionOptions,
): Promise<TestLanguageRuntimeSession> {
	// Get or create the runtime.
	const runtime = options?.runtime ?? createTestLanguageRuntimeMetadata(instantiationService, disposables);

	// Start the session.
	const runtimeSessionService = instantiationService.get(IRuntimeSessionService);
	const sessionId = await runtimeSessionService.startNewRuntimeSession(
		runtime.runtimeId,
		options?.sessionName ?? 'test-session',
		options?.sessionMode ?? LanguageRuntimeSessionMode.Console,
		options?.notebookUri,
		options?.startReason ?? 'Test requested to start a runtime session',
	);

	// Get the session.
	const session = runtimeSessionService.getSession(sessionId);
	if (!session) {
		throw new Error(`Failed to get session with ID '${sessionId}' after starting it`);
	}

	if (!(session instanceof TestLanguageRuntimeSession)) {
		throw new Error(`Session with ID '${sessionId}' is not a TestLanguageRuntimeSession`);
	}

	disposables.add(session);
	return session;
}
