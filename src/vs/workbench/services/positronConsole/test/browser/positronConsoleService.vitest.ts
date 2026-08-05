/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { IConsoleFindWidget, IConsoleFindWidgetFactory, IPositronConsoleInstance } from '../../browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../browser/positronConsoleService.js';

describe('PositronConsoleService', () => {

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

	it('clears the active console instance when the active console is deleted', async () => {
		const consoleService = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronConsoleService));
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		expect(consoleService.activePositronConsoleInstance?.sessionId).toBe(session.sessionId);

		const active: (IPositronConsoleInstance | undefined)[] = [];
		ctx.disposables.add(consoleService.onDidChangeActivePositronConsoleInstance(
			instance => active.push(instance)));

		// There is no other console to fall back to, so nothing else reports an active console
		// change here: the foreground session becomes `undefined`, which the foreground session
		// handler ignores. Consumers that track the active console -- the extension host behind
		// `positron.window.activeConsoleEditor` among them -- would keep the deleted console.
		consoleService.deletePositronConsoleSession(session.sessionId);

		expect(active.map(instance => instance?.sessionId)).toEqual([undefined]);
		expect(consoleService.activePositronConsoleInstance).toBeUndefined();
	});
});
