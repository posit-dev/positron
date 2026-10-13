/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { TestWorkspaceTrustManagementService } from '../../../../test/common/workbenchTestServices.js';
import { TestViewsService } from '../../../../test/browser/workbenchTestServices.js';
import { IViewsService } from '../../../views/common/viewsService.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, LanguageStartupBehavior, RuntimeExitReason, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../runtimeStartup/common/runtimeStartupService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { RuntimeItemActivity } from '../../browser/classes/runtimeItemActivity.js';
import { RuntimeItemStandard } from '../../browser/classes/runtimeItemStandard.js';
import { PositronConsoleService, scrollbackSizeSettingId } from '../../browser/positronConsoleService.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, IPositronConsoleInstance } from '../../browser/interfaces/positronConsoleService.js';

/**
 * Discard activity routing by execution ID on detach. Otherwise, late messages
 * from the old runtime mutate historical activity instead of creating a new item.
 */
describe('Positron - console activity routing across a detach', () => {
	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeStartupService, {
			getRestoredSessions: () => Promise.resolve([]),
			onSessionRestoreFailure: Event.None,
		})
		// The console service tracks the console view's visibility.
		.stub(IViewsService, new TestViewsService())
		.stub(IConsoleFindWidgetFactory, {
			createFindWidget: () => stubInterface<IConsoleFindWidget>({
				onDidHide: Event.None,
				dispose: () => { },
			}),
		})
		.build();

	let consoleService: PositronConsoleService;
	let runtime: ILanguageRuntimeMetadata;

	beforeEach(() => {
		const configService = ctx.instantiationService.get(IConfigurationService) as TestConfigurationService;
		configService.setUserConfiguration('interpreters.startupBehavior', LanguageStartupBehavior.Auto);
		// Without a scrollback budget the console trims every item but the newest.
		configService.setUserConfiguration(scrollbackSizeSettingId, 1000);

		const workspaceTrust = ctx.instantiationService.get(IWorkspaceTrustManagementService) as TestWorkspaceTrustManagementService;
		workspaceTrust.setWorkspaceTrust(true);

		consoleService = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronConsoleService));

		runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);

		const runtimeSessionService = ctx.instantiationService.get(IRuntimeSessionService);
		ctx.disposables.add({
			dispose() {
				runtimeSessionService.activeSessions.forEach(s => s.dispose());
			}
		});
	});

	async function startConsoleSession() {
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{
				runtime,
				sessionName: runtime.runtimeName,
				sessionMode: LanguageRuntimeSessionMode.Console,
			});
		session.setRuntimeState(RuntimeState.Ready);
		const consoleInstance = consoleService.positronConsoleInstances.find(
			instance => instance.sessionId === session.sessionId)!;
		return { session, consoleInstance };
	}

	function activitiesFor(consoleInstance: IPositronConsoleInstance, executionId: string): RuntimeItemActivity[] {
		return consoleInstance.runtimeItems.filter(
			(item): item is RuntimeItemActivity => item instanceof RuntimeItemActivity && item.id === executionId);
	}

	function textOf(activity: RuntimeItemActivity): string {
		return activity.getClipboardRepresentation('').join('\n');
	}

	it('routes a late message for a pre-restart execution to a new activity item, not the old one', async () => {
		const { session, consoleInstance } = await startConsoleSession();

		const executionId = 'exec-1';
		session.receiveStreamMessage({ parent_id: executionId, text: 'first output\n' });

		const [originalActivity] = activitiesFor(consoleInstance, executionId);
		expect(originalActivity).toBeDefined();
		expect(textOf(originalActivity)).toBe('first output');

		session.setRuntimeState(RuntimeState.Exited);
		session.endSession({ reason: RuntimeExitReason.ForcedQuit });
		session.setRuntimeState(RuntimeState.Starting);
		session.setRuntimeState(RuntimeState.Ready);

		session.receiveStreamMessage({ parent_id: executionId, text: 'late output\n' });

		const activitiesAfter = activitiesFor(consoleInstance, executionId);
		expect(activitiesAfter).toHaveLength(2);

		expect(activitiesAfter[0]).toBe(originalActivity);
		expect(textOf(activitiesAfter[0])).toBe('first output');

		expect(activitiesAfter[1]).not.toBe(originalActivity);
		expect(textOf(activitiesAfter[1])).toBe('late output');

		// A late message must appear after the restart lifecycle entry.
		const restartedIndex = consoleInstance.runtimeItems.findIndex(item =>
			item instanceof RuntimeItemStandard &&
			item.outputLines.some(line => line.outputRuns.some(run => run.text.includes('restarted.'))));
		expect(restartedIndex).toBeGreaterThan(-1);
		expect(consoleInstance.runtimeItems.indexOf(activitiesAfter[1])).toBeGreaterThan(restartedIndex);
	});

	it('drops the execution id from the routing map on detach', async () => {
		const { session, consoleInstance } = await startConsoleSession();

		const executionId = 'exec-2';
		session.receiveStreamMessage({ parent_id: executionId, text: 'output\n' });
		expect(consoleInstance.revealExecution(executionId)).toBe(true);

		session.setRuntimeState(RuntimeState.Exited);
		session.endSession({ reason: RuntimeExitReason.ForcedQuit });

		expect(consoleInstance.revealExecution(executionId)).toBe(false);
		expect(activitiesFor(consoleInstance, executionId)).toHaveLength(1);
	});
});
