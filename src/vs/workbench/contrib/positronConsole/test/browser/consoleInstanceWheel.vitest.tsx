/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fireEvent, screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createWheelEvent } from '../../../../../test/vitest/vitestUtils.js';
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ConsoleInstance } from '../../browser/components/consoleInstance.js';

/**
 * Mock the console's items, which render the console input and its editor. These tests observe
 * only the console instance's own wheel handling.
 */
vi.mock('../../browser/components/consoleInstanceItems.js', () => ({
	ConsoleInstanceItems: () => null,
}));

/**
 * Mock the font configuration, which measures fonts from editor settings. ConsoleInstance only
 * divides its width by the space width.
 */
vi.mock('../../../../browser/fontConfigurationManager.js', () => ({
	FontConfigurationManager: {
		getFontInfo: () => ({ spaceWidth: 10 }),
		fontConfigurationWatcher: () => ({ dispose: () => { } }),
	},
}));

/**
 * Mock the console context. ConsoleInstance reads only the active instance from it, and the real
 * provider needs the console service.
 */
vi.mock('../../browser/positronConsoleContext.js', () => ({
	usePositronConsoleContext: () => ({ activePositronConsoleInstance: undefined }),
}));

describe('ConsoleInstance - wheel', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	/**
	 * Renders an active, scrollable console that is not scroll locked.
	 * @returns The console instance and its scroll container.
	 */
	function renderConsole() {
		const positronConsoleInstance = stubInterface<IPositronConsoleInstance>({
			sessionMetadata: stubInterface<IPositronConsoleInstance['sessionMetadata']>({ sessionId: 'r' }),
			state: PositronConsoleState.Ready,
			trace: false,
			wordWrap: true,
			runtimeAttached: true,
			scrollLocked: false,
			lastScrollTop: 0,
			findWidgetDomNode: undefined,
			setWidthInChars: () => { },
			refreshFindHighlights: () => { },
			layoutFindWidget: () => { },
			onDidChangeState: Event.None,
			onDidChangeCodeSubmissionInProgress: Event.None,
			onDidChangeTrace: Event.None,
			onDidChangeWordWrap: Event.None,
			onDidChangeRuntimeItems: Event.None,
			onDidExecuteCode: Event.None,
			onDidSelectPlot: Event.None,
			onDidRequestRestart: Event.None,
			onDidSelectAll: Event.None,
			onDidAttachSession: Event.None,
			onDidRequestRevealExecution: Event.None,
		});
		const reactComponentContainer = stubInterface<IReactComponentContainer>({
			onSizeChanged: Event.None,
			onVisibilityChanged: Event.None,
			onSaveScrollPosition: Event.None,
			onRestoreScrollPosition: Event.None,
			onFocused: Event.None,
		});
		rtl.render(
			<ConsoleInstance
				active
				height={400}
				positronConsoleInstance={positronConsoleInstance}
				reactComponentContainer={reactComponentContainer}
				width={600}
			/>
		);

		// The test DOM does no layout, so give the scroll container content taller than itself.
		const element = screen.getByRole('tabpanel');
		Object.defineProperty(element, 'scrollHeight', { value: 1000, configurable: true });
		Object.defineProperty(element, 'clientHeight', { value: 400, configurable: true });
		return { positronConsoleInstance, element };
	}

	it('keeps wheel events from reaching the workbench, except ctrl + wheel', () => {
		const { element } = renderConsole();
		const ancestorListener = vi.fn();
		document.body.addEventListener('wheel', ancestorListener);
		try {
			fireEvent(element, createWheelEvent({ deltaY: 100 }));
			fireEvent(element, createWheelEvent({ deltaY: 100, ctrlKey: true }));
		} finally {
			document.body.removeEventListener('wheel', ancestorListener);
		}

		expect(ancestorListener.mock.calls.map(([e]) => (e as WheelEvent).ctrlKey)).toEqual([true]);
	});

	// A lock without a scroll would stop the console following new output while it still shows the
	// bottom.
	it('engages scroll lock on wheel up, but not on ctrl + wheel up', () => {
		const { positronConsoleInstance, element } = renderConsole();

		fireEvent(element, createWheelEvent({ deltaY: -100, ctrlKey: true }));
		const lockedAfterCtrlWheel = positronConsoleInstance.scrollLocked;
		fireEvent(element, createWheelEvent({ deltaY: -100 }));

		expect({ lockedAfterCtrlWheel, lockedAfterWheel: positronConsoleInstance.scrollLocked })
			.toEqual({ lockedAfterCtrlWheel: false, lockedAfterWheel: true });
	});
});
