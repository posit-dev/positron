/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { TestViewsService } from '../../../../test/browser/workbenchTestServices.js';
import { IViewsService } from '../../../views/common/viewsService.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, POSITRON_CONSOLE_VIEW_ID } from '../../browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../browser/positronConsoleService.js';

describe('PositronConsoleService unread execution count', () => {

	const ctx = createTestContainer()
		.withWorkbenchServices()
		// Console instances create a find widget on construction; the widget itself is UI that
		// nothing here exercises.
		.stub(IConsoleFindWidgetFactory, {
			createFindWidget: () => stubInterface<IConsoleFindWidget>({
				onDidHide: Event.None,
				dispose: () => { }
			})
		})
		.build();

	/** Start two console sessions; the second one started is the active console. */
	async function startTwoSessions() {
		const consoleService = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronConsoleService));
		const background = await startTestLanguageRuntimeSession(
			ctx.instantiationService, ctx.disposables, { sessionName: 'background' });
		const foreground = await startTestLanguageRuntimeSession(
			ctx.instantiationService, ctx.disposables, { sessionName: 'foreground' });
		consoleService.setActivePositronConsoleSession(foreground.sessionId);

		const getCount = (sessionId: string) => consoleService.positronConsoleInstances
			.find(instance => instance.sessionId === sessionId)!
			.unreadExecutionCount.get();

		return { consoleService, background, foreground, getCount };
	}

	/** Show or hide the console view, as the views service reports it. */
	function setConsoleViewVisible(visible: boolean) {
		const viewsService = ctx.get(IViewsService) as TestViewsService;
		vi.spyOn(viewsService, 'isViewVisible').mockImplementation(id =>
			id === POSITRON_CONSOLE_VIEW_ID ? visible : true);
		viewsService.onDidChangeViewVisibilityEmitter.fire({ id: POSITRON_CONSOLE_VIEW_ID, visible });
	}

	it('counts executions that start in a console that is not active', async () => {
		const { background, getCount } = await startTwoSessions();

		// The second execution is one the console did not submit, as from an
		// external agent through the MCP server; it counts the same.
		background.receiveInputMessage({ parent_id: 'exec-1', code: '1 + 1' });
		background.receiveExecutionRequestedMessage({
			parent_id: 'exec-2',
			code: '2 + 2',
			attribution: { source: 'agent' },
		});
		background.receiveInputMessage({ parent_id: 'exec-2', code: '2 + 2' });

		expect(getCount(background.sessionId)).toBe(2);
	});

	it('does not count executions in the active console', async () => {
		const { foreground, getCount } = await startTwoSessions();

		foreground.receiveInputMessage({ parent_id: 'exec-1', code: '1 + 1' });

		expect(getCount(foreground.sessionId)).toBe(0);
	});

	it('resets the count when the console becomes active', async () => {
		const { consoleService, background, foreground, getCount } = await startTwoSessions();
		background.receiveInputMessage({ parent_id: 'exec-1', code: '1 + 1' });

		consoleService.setActivePositronConsoleSession(background.sessionId);
		expect(getCount(background.sessionId)).toBe(0);

		// Now that the other console is in the background, it starts counting.
		foreground.receiveInputMessage({ parent_id: 'exec-2', code: '2 + 2' });
		background.receiveInputMessage({ parent_id: 'exec-3', code: '3 + 3' });
		expect({
			background: getCount(background.sessionId),
			foreground: getCount(foreground.sessionId),
		}).toEqual({ background: 0, foreground: 1 });
	});

	it('counts executions in the active console while the console view is hidden', async () => {
		const { foreground, getCount } = await startTwoSessions();

		setConsoleViewVisible(false);
		foreground.receiveInputMessage({ parent_id: 'exec-1', code: '1 + 1' });

		expect(getCount(foreground.sessionId)).toBe(1);
	});

	it('resets the active console count when the console view becomes visible', async () => {
		const { background, foreground, getCount } = await startTwoSessions();
		setConsoleViewVisible(false);
		foreground.receiveInputMessage({ parent_id: 'exec-1', code: '1 + 1' });
		background.receiveInputMessage({ parent_id: 'exec-2', code: '2 + 2' });

		setConsoleViewVisible(true);

		// Only the console on screen has been seen; the other keeps its count.
		expect({
			background: getCount(background.sessionId),
			foreground: getCount(foreground.sessionId),
		}).toEqual({ background: 1, foreground: 0 });
	});
});
