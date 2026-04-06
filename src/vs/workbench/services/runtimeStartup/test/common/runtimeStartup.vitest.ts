/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { isWeb } from '../../../../../base/common/platform.js';
import { arch as systemArch } from '../../../../../base/common/process.js';
import { INotificationService, IPromptChoice, IPromptOptions, Severity } from '../../../../../platform/notification/common/notification.js';
import { LanguageRuntimeArchitecture } from '../../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../runtimeSession/common/runtimeSessionService.js';
import { RuntimeStartupService } from '../../common/runtimeStartup.js';
import { createRuntimeServices } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IEphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralState.js';
import { BeforeShutdownEvent, ILifecycleService, WillShutdownEvent } from '../../../lifecycle/common/lifecycle.js';
import { IPositronNewFolderService, NewFolderStartupPhase } from '../../../positronNewFolder/common/positronNewFolder.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';

/**
 * Helper to create common service stubs for RuntimeStartupService tests.
 */
/// <reference types="vitest/globals" />
function createCommonStubs(
	instantiationService: TestInstantiationService,
	notificationService: MockNotificationService,
	remoteAuthority?: string
): void {
	instantiationService.stub(INotificationService, notificationService);
	instantiationService.stub(IEphemeralStateService, {
		getItem: () => Promise.resolve(undefined),
		setItem: () => Promise.resolve(),
	});
	instantiationService.stub(ILifecycleService, {
		onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
		onWillShutdown: new Emitter<WillShutdownEvent>().event,
	});
	instantiationService.stub(IPositronNewFolderService, {
		onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
		startupPhase: NewFolderStartupPhase.Complete,
	});
	instantiationService.stub(IProgressService, {});
	instantiationService.stub(IWorkbenchEnvironmentService, {
		remoteAuthority,
	});
}

describe('Positron - RuntimeStartupService Architecture Mismatch', () => {

	describe('Local sessions', () => {
		const ctx = createTestContainer().withRuntimeServices().build();

		let instantiationService: TestInstantiationService;
		let notificationService: MockNotificationService;
		let runtimeStartupService: RuntimeStartupService;

		beforeEach(() => {
			instantiationService = ctx.disposables.add(new TestInstantiationService());
			createRuntimeServices(instantiationService, ctx.disposables);
			notificationService = new MockNotificationService();
			createCommonStubs(instantiationService, notificationService, undefined);
			runtimeStartupService = ctx.disposables.add(instantiationService.createInstance(RuntimeStartupService));
		});

		// Architecture mismatch checks are skipped on web since the browser's
		// architecture doesn't relate to where the interpreter is running
		(isWeb ? it.skip : it)('no notification when architectures match', () => {
			// Use the same architecture as the system
			const matchingArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.Arm64
				: LanguageRuntimeArchitecture.X64;

			const mockSession = {
				runtimeMetadata: { languageId: 'python', runtimeName: 'Python 3.12.0' }
			} as unknown as ILanguageRuntimeSession;
			const mockRuntimeInfo = { interpreterArch: matchingArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(notificationService.promptCalls.length).toBe(0);
		});

		(isWeb ? it.skip : it)('notification shown with correct message when architectures mismatch', () => {
			// Use a different architecture than the system
			const mismatchedArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.X64
				: LanguageRuntimeArchitecture.Arm64;
			const mismatchedArchStr = systemArch === 'arm64' ? 'x64' : 'arm64';

			const mockSession = {
				runtimeMetadata: { languageId: 'python', runtimeName: 'Python 3.12.0 (x64)' }
			} as unknown as ILanguageRuntimeSession;
			const mockRuntimeInfo = { interpreterArch: mismatchedArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(notificationService.promptCalls.length).toBe(1);

			const call = notificationService.promptCalls[0];
			expect(call.severity).toBe(Severity.Warning);
			const expectedMessage = `The interpreter "Python 3.12.0 (x64)" has a different architecture (${mismatchedArchStr}) than your system (${systemArch}). This may cause problems with performance and package compatibility.`;
			expect(call.message).toBe(expectedMessage);
		});
	});

	describe('Remote SSH sessions', () => {
		const ctx = createTestContainer().withRuntimeServices().build();

		let instantiationService: TestInstantiationService;
		let notificationService: MockNotificationService;
		let runtimeStartupService: RuntimeStartupService;

		beforeEach(() => {
			instantiationService = ctx.disposables.add(new TestInstantiationService());
			createRuntimeServices(instantiationService, ctx.disposables);
			notificationService = new MockNotificationService();
			createCommonStubs(instantiationService, notificationService, 'ssh-remote+myserver');
			runtimeStartupService = ctx.disposables.add(instantiationService.createInstance(RuntimeStartupService));
		});

		it('no notification even when architectures mismatch', () => {
			// Use a different architecture than the system (would normally trigger warning)
			const mismatchedArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.X64
				: LanguageRuntimeArchitecture.Arm64;

			const mockSession = {
				runtimeMetadata: { languageId: 'python', runtimeName: 'Python 3.12.0 (x64)' }
			} as unknown as ILanguageRuntimeSession;
			const mockRuntimeInfo = { interpreterArch: mismatchedArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(notificationService.promptCalls.length).toBe(0);
		});
	});
});

/**
 * Mock notification service that captures prompt calls for testing.
 */
/// <reference types="vitest/globals" />
class MockNotificationService implements Partial<INotificationService> {
	promptCalls: Array<{
		severity: Severity;
		message: string;
		choices?: IPromptChoice[];
		options?: IPromptOptions;
	}> = [];

	prompt(severity: Severity, message: string, choices?: IPromptChoice[], options?: IPromptOptions) {
		this.promptCalls.push({ severity, message, choices, options });
		return {
			close: () => { },
			onDidClose: new Emitter<void>().event,
			onDidChangeVisibility: new Emitter<boolean>().event,
			progress: { infinite: () => { }, total: () => { }, worked: () => { }, done: () => { } },
			updateSeverity: () => { },
			updateMessage: () => { },
			updateActions: () => { },
		};
	}
}
