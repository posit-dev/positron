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
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, LanguageStartupBehavior, RuntimeExitReason, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../runtimeStartup/common/runtimeStartupService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { RuntimeItemStandard } from '../../browser/classes/runtimeItemStandard.js';
import { PositronConsoleService, scrollbackSizeSettingId } from '../../browser/positronConsoleService.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, IPositronConsoleInstance } from '../../browser/interfaces/positronConsoleService.js';

/**
 * Regression tests for https://github.com/posit-dev/positron/issues/10016.
 *
 * On an in-place kernel restart the supervisor emits two independent signals: the
 * `Starting` state of the replacement kernel, and the `Restart` exit of the kernel
 * that just went away. Their relative order is not guaranteed. The console has to
 * end up showing "<session> restarted." either way.
 */
describe('Positron - console restart ordering', () => {
	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeStartupService, {
			getRestoredSessions: () => Promise.resolve([]),
			onSessionRestoreFailure: Event.None,
		})
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

	/**
	 * Starts a console session and returns it alongside its console instance.
	 */
	async function startConsoleSession() {
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{
				runtime,
				sessionName: runtime.runtimeName,
				startReason: 'Test requested a console session',
				sessionMode: LanguageRuntimeSessionMode.Console,
			});
		// Let the initial start complete, as it has by the time a user can ask
		// for a restart.
		session.setRuntimeState(RuntimeState.Ready);
		const consoleInstance = consoleService.positronConsoleInstances.find(
			instance => instance.sessionId === session.sessionId)!;
		return { session, consoleInstance };
	}

	/** Flattens every runtime item in the console down to its rendered text. */
	function consoleText(consoleInstance: IPositronConsoleInstance): string {
		return consoleInstance.runtimeItems
			.filter(item => item instanceof RuntimeItemStandard)
			.flatMap(item => item.outputLines)
			.flatMap(line => line.outputRuns.map(run => run.text))
			.join('\n');
	}

	it('shows "restarted." when the restart exit arrives before the new kernel starts', async () => {
		const { session, consoleInstance } = await startConsoleSession();

		session.setRuntimeState(RuntimeState.Exited);
		session.endSession({ reason: RuntimeExitReason.Restart });
		session.setRuntimeState(RuntimeState.Starting);
		session.setRuntimeState(RuntimeState.Ready);

		expect(consoleText(consoleInstance)).toMatchInlineSnapshot(`
			"Test 0.0.1 started.
			Test 0.0.1 exited (preparing for restart)
			Test 0.0.1 restarted."
		`);
	});

	it('shows "restarted." when the restart exit arrives after the new kernel starts', async () => {
		const { session, consoleInstance } = await startConsoleSession();

		session.setRuntimeState(RuntimeState.Exited);
		session.setRuntimeState(RuntimeState.Starting);
		// The exit of the previous kernel lands late, after the replacement has
		// already begun starting.
		session.endSession({ reason: RuntimeExitReason.Restart });
		session.setRuntimeState(RuntimeState.Ready);

		// The late exit is dropped, so there's no "exited (preparing for restart)"
		// line here. Appending it would report the exit as happening after the
		// restart finished.
		expect(consoleText(consoleInstance)).toMatchInlineSnapshot(`
			"Test 0.0.1 started.
			Test 0.0.1 restarted."
		`);
	});

	it('stays attached when the restart exit arrives after the new kernel starts', async () => {
		const { session, consoleInstance } = await startConsoleSession();

		session.setRuntimeState(RuntimeState.Exited);
		session.setRuntimeState(RuntimeState.Starting);
		session.endSession({ reason: RuntimeExitReason.Restart });
		session.setRuntimeState(RuntimeState.Ready);

		// Detaching here would leave the console unable to see anything the
		// restarted session does, even though it is online.
		expect(consoleInstance.runtimeAttached).toBe(true);
	});
});
