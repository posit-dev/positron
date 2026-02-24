/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { arch as systemArch } from '../../../../../base/common/process.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
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

suite('Positron - RuntimeStartupService Architecture Mismatch', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let notificationService: MockNotificationService;
	let runtimeStartupService: RuntimeStartupService;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		createRuntimeServices(instantiationService, disposables);

		notificationService = new MockNotificationService();
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

		runtimeStartupService = disposables.add(instantiationService.createInstance(RuntimeStartupService));
	});

	test('no notification when architectures match', () => {
		// Use the same architecture as the system
		const matchingArch = systemArch === 'arm64'
			? LanguageRuntimeArchitecture.Arm64
			: LanguageRuntimeArchitecture.X64;

		const mockSession = {
			runtimeMetadata: { languageId: 'python', runtimeName: 'Python 3.12.0' }
		} as unknown as ILanguageRuntimeSession;
		const mockRuntimeInfo = { interpreterArch: matchingArch };

		runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

		assert.strictEqual(notificationService.promptCalls.length, 0, 'Should not show notification when architectures match');
	});

	test('notification shown with correct message when architectures mismatch', () => {
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

		assert.strictEqual(notificationService.promptCalls.length, 1, 'Should show notification when architectures mismatch');

		const call = notificationService.promptCalls[0];
		assert.strictEqual(call.severity, Severity.Warning);
		const expectedMessage = `The interpreter "Python 3.12.0 (x64)" has a different architecture (${mismatchedArchStr}) than your system (${systemArch}). This may cause problems with performance and package compatibility.`;
		assert.strictEqual(call.message, expectedMessage);
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
