/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { isWeb } from '../../../../../base/common/platform.js';
import { arch as systemArch } from '../../../../../base/common/process.js';
import { INotificationService, IPromptChoice, IPromptOptions, Severity } from '../../../../../platform/notification/common/notification.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeArchitecture } from '../../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../runtimeSession/common/runtimeSessionService.js';
import { RuntimeStartupService } from '../../common/runtimeStartup.js';
import { IEphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralState.js';
import { BeforeShutdownEvent, ILifecycleService, WillShutdownEvent } from '../../../lifecycle/common/lifecycle.js';
import { IPositronNewFolderService, NewFolderStartupPhase } from '../../../positronNewFolder/common/positronNewFolder.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';

describe('Positron - RuntimeStartupService Architecture Mismatch', () => {

	describe('Local sessions', () => {
		const notificationService = new MockNotificationService();
		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(INotificationService, notificationService)
			.stub(IEphemeralStateService, {
				getItem: () => Promise.resolve(undefined),
				setItem: () => Promise.resolve(),
			})
			.stub(ILifecycleService, {
				onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
				onWillShutdown: new Emitter<WillShutdownEvent>().event,
			})
			.stub(IPositronNewFolderService, {
				onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
				startupPhase: NewFolderStartupPhase.Complete,
			})
			.stub(IProgressService, {})
			.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
			.build();

		let runtimeStartupService: RuntimeStartupService;
		beforeEach(() => {
			// Reset captured calls from prior tests in this describe.
			notificationService.promptCalls = [];
			runtimeStartupService = ctx.disposables.add(
				ctx.instantiationService.createInstance(RuntimeStartupService)
			);
		});

		// Architecture mismatch checks are skipped on web since the browser's
		// architecture doesn't relate to where the interpreter is running
		(isWeb ? it.skip : it)('no notification when architectures match', () => {
			// Use the same architecture as the system
			const matchingArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.Arm64
				: LanguageRuntimeArchitecture.X64;

			const mockSession = stubInterface<ILanguageRuntimeSession>({
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
					languageId: 'python',
					runtimeName: 'Python 3.12.0',
				}),
			});
			const mockRuntimeInfo = { interpreterArch: matchingArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(notificationService.promptCalls.length, 'Should not show notification when architectures match').toBe(0);
		});

		(isWeb ? it.skip : it)('notification shown with correct message when architectures mismatch', () => {
			// Use a different architecture than the system
			const mismatchedArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.X64
				: LanguageRuntimeArchitecture.Arm64;
			const mismatchedArchStr = systemArch === 'arm64' ? 'x64' : 'arm64';

			const mockSession = stubInterface<ILanguageRuntimeSession>({
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
					languageId: 'python',
					runtimeName: 'Python 3.12.0 (x64)',
				}),
			});
			const mockRuntimeInfo = { interpreterArch: mismatchedArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(notificationService.promptCalls.length, 'Should show notification when architectures mismatch').toBe(1);

			const call = notificationService.promptCalls[0];
			expect(call.severity).toBe(Severity.Warning);
			const expectedMessage = `The interpreter "Python 3.12.0 (x64)" has a different architecture (${mismatchedArchStr}) than your system (${systemArch}). This may cause problems with performance and package compatibility.`;
			expect(call.message).toBe(expectedMessage);
		});
	});

	describe('Remote SSH sessions', () => {
		const notificationService = new MockNotificationService();
		const ctx = createTestContainer()
			.withRuntimeServices()
			.stub(INotificationService, notificationService)
			.stub(IEphemeralStateService, {
				getItem: () => Promise.resolve(undefined),
				setItem: () => Promise.resolve(),
			})
			.stub(ILifecycleService, {
				onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
				onWillShutdown: new Emitter<WillShutdownEvent>().event,
			})
			.stub(IPositronNewFolderService, {
				onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
				startupPhase: NewFolderStartupPhase.Complete,
			})
			.stub(IProgressService, {})
			.stub(IWorkbenchEnvironmentService, { remoteAuthority: 'ssh-remote+myserver' })
			.build();

		let runtimeStartupService: RuntimeStartupService;
		beforeEach(() => {
			// Reset captured calls from prior tests in this describe.
			notificationService.promptCalls = [];
			runtimeStartupService = ctx.disposables.add(
				ctx.instantiationService.createInstance(RuntimeStartupService)
			);
		});

		it('no notification even when architectures mismatch', () => {
			// Use a different architecture than the system (would normally trigger warning)
			const mismatchedArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.X64
				: LanguageRuntimeArchitecture.Arm64;

			const mockSession = stubInterface<ILanguageRuntimeSession>({
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
					languageId: 'python',
					runtimeName: 'Python 3.12.0 (x64)',
				}),
			});
			const mockRuntimeInfo = { interpreterArch: mismatchedArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(
				notificationService.promptCalls.length,
				'Should not show notification in remote SSH sessions'
			).toBe(0);
		});
	});
});

/**
 * Mock notification service that captures prompt calls for testing.
 */
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
