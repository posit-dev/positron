/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { LanguageService } from '../../../../../editor/common/services/languageService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IExtensionService } from '../../../extensions/common/extensions.js';
import { LanguageRuntimeService } from '../../../languageRuntime/common/languageRuntime.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IPositronModalDialogsService } from '../../../positronModalDialogs/common/positronModalDialogs.js';
import { RuntimeSessionService } from '../../common/runtimeSession.js';
import { IRuntimeSessionService, RuntimeStartMode } from '../../common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from './testLanguageRuntimeSession.js';
import { TestOpenerService, TestPositronModalDialogService, TestCommandService, TestRuntimeSessionManager } from '../../../../test/common/positronWorkbenchTestServices.js';
import { TestExtensionService, TestStorageService, TestWorkspaceTrustManagementService } from '../../../../test/common/workbenchTestServices.js';

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
		RuntimeStartMode.Starting,
		true
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
