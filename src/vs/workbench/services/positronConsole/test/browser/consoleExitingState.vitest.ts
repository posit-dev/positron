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
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, LanguageStartupBehavior, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../runtimeStartup/common/runtimeStartupService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronConsoleService, scrollbackSizeSettingId } from '../../browser/positronConsoleService.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, PositronConsoleState } from '../../browser/interfaces/positronConsoleService.js';

/**
 * Restart teardown can execute a hanging `.Last` hook. Map `RuntimeState.Restarting`
 * to `PositronConsoleState.Exiting` so the prompt hides during teardown.
 */
describe('Positron - console state while restarting or exiting', () => {
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

	it('reports Exiting when the runtime starts restarting', async () => {
		const { session, consoleInstance } = await startConsoleSession();

		session.setRuntimeState(RuntimeState.Restarting);

		expect(consoleInstance.state).toBe(PositronConsoleState.Exiting);
	});

	it('reports Exiting when the runtime starts shutting down', async () => {
		const { session, consoleInstance } = await startConsoleSession();

		session.setRuntimeState(RuntimeState.Exiting);
		expect(consoleInstance.state).toBe(PositronConsoleState.Exiting);

		// Reach `Exited` to dispose the watchdog that `RuntimeSessionService` starts on `Exiting`.
		session.setRuntimeState(RuntimeState.Exited);
	});
});
