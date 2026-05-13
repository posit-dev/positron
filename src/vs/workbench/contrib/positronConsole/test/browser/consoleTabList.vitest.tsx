/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IResourceUsageHistoryService } from '../../../../services/positronConsole/browser/resourceUsageHistoryService.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestPositronConsoleInstance, TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { ConsoleTabList } from '../../browser/components/consoleTabList.js';
import { PositronConsoleContextProvider } from '../../browser/positronConsoleContext.js';

describe('ConsoleTabList', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IContextMenuService, { showContextMenu: vi.fn() })
		.stub(IResourceUsageHistoryService, { getHistory: async () => [] })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function addConsoleInstance(
		sessionId: string,
		sessionName: string,
		options: { languageId?: string; createdTimestamp?: number } = {}
	): TestPositronConsoleInstance {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId,
			sessionMode: LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
			createdTimestamp: options.createdTimestamp ?? 0,
			startReason: 'test',
		};
		const runtimeMetadata = stubInterface<ILanguageRuntimeMetadata>({
			base64EncodedIconSvg: undefined,
			languageId: options.languageId ?? 'python',
		});
		const instance = new TestPositronConsoleInstance(sessionId, sessionName, sessionMetadata, runtimeMetadata);
		const consoleService = ctx.get(IPositronConsoleService) as TestPositronConsoleService;
		consoleService.addTestConsoleInstance(instance);
		return instance;
	}

	function renderTabList() {
		rtl.render(
			<PositronConsoleContextProvider>
				<ConsoleTabList height={400} width={200} />
			</PositronConsoleContextProvider>
		);
	}

	it('renders one tab per console instance', () => {
		addConsoleInstance('session-1', 'Session 1');
		addConsoleInstance('session-2', 'Session 2');
		renderTabList();
		expect(screen.getAllByRole('tab')).toHaveLength(2);
	});

	it('renders tabs sorted oldest-first by createdTimestamp', () => {
		addConsoleInstance('session-newer', 'Newer Session', { createdTimestamp: 200 });
		addConsoleInstance('session-older', 'Older Session', { createdTimestamp: 100 });
		renderTabList();
		const tabs = screen.getAllByRole('tab');
		expect(tabs[0]).toHaveAttribute('aria-label', 'Older Session');
		expect(tabs[1]).toHaveAttribute('aria-label', 'Newer Session');
	});

	it('renders tabs for sessions with different language IDs', () => {
		addConsoleInstance('session-py', 'Python Session', { languageId: 'python' });
		addConsoleInstance('session-r-1', 'R Session 1', { languageId: 'r' });
		addConsoleInstance('session-r-2', 'R Session 2', { languageId: 'r' });
		renderTabList();
		expect(screen.getAllByRole('tab')).toHaveLength(3);
		expect(screen.getByRole('tab', { name: 'Python Session' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'R Session 1' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'R Session 2' })).toBeInTheDocument();
	});
});
