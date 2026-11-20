/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fireEvent, screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { TestPositronVariablesInstance } from '../../../../services/positronVariables/test/common/testPositronVariablesInstance.js';
import { PositronVariablesContextProvider } from '../../browser/positronVariablesContext.js';
import { VariablesInstance } from '../../browser/components/variablesInstance.js';

describe('VariablesInstance', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronVariablesService, {
			positronVariablesInstances: [],
			activePositronVariablesInstance: undefined,
			onDidStartPositronVariablesInstance: Event.None,
			onDidStopPositronVariablesInstance: Event.None,
			onDidChangeActivePositronVariablesInstance: Event.None,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderInstance(sessionId: string) {
		const instance = ctx.disposables.add(new TestPositronVariablesInstance(
			stubInterface<ILanguageRuntimeSession>({ sessionId })));
		const reactComponentContainer = stubInterface<IReactComponentContainer>({
			onSaveScrollPosition: Event.None,
			onRestoreScrollPosition: Event.None,
		});
		rtl.render(
			<PositronVariablesContextProvider reactComponentContainer={reactComponentContainer}>
				<VariablesInstance
					active
					height={200}
					positronVariablesInstance={instance}
					reactComponentContainer={reactComponentContainer}
					width={400}
				/>
			</PositronVariablesContextProvider>
		);
		return screen.getByTestId(`variables-${sessionId}`);
	}

	/**
	 * Creates a bubbling wheel event. The test DOM's WheelEvent drops the modifier keys from its
	 * init dictionary, so they are defined on the event directly.
	 */
	function wheelEvent(init: { deltaY: number; shiftKey?: boolean; ctrlKey?: boolean }) {
		const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: init.deltaY });
		Object.defineProperty(event, 'shiftKey', { value: init.shiftKey ?? false });
		Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false });
		return event;
	}

	// On web, the workbench container cancels every wheel event that reaches it, which would
	// cancel native scrolling of the list, so the instance must keep wheel events to itself.
	it('keeps wheel events from reaching the workbench, except ctrl + wheel', () => {
		const element = renderInstance('python');
		const ancestorListener = vi.fn();
		document.body.addEventListener('wheel', ancestorListener);
		try {
			fireEvent(element, wheelEvent({ deltaY: 100 }));
			fireEvent(element, wheelEvent({ deltaY: 100, shiftKey: true }));
			fireEvent(element, wheelEvent({ deltaY: 100, ctrlKey: true }));
		} finally {
			document.body.removeEventListener('wheel', ancestorListener);
		}

		expect(ancestorListener.mock.calls.map(([e]) => (e as WheelEvent).ctrlKey)).toEqual([true]);
	});

	it('takes inactive instances out of the accessibility tree and tab order', () => {
		const python = ctx.disposables.add(new TestPositronVariablesInstance(
			stubInterface<ILanguageRuntimeSession>({ sessionId: 'python' })));
		const r = ctx.disposables.add(new TestPositronVariablesInstance(
			stubInterface<ILanguageRuntimeSession>({ sessionId: 'r' })));
		const reactComponentContainer = stubInterface<IReactComponentContainer>({
			onSaveScrollPosition: Event.None,
			onRestoreScrollPosition: Event.None,
		});

		// Stack the instances the way VariablesCore does: one per session, only one active.
		rtl.render(
			<PositronVariablesContextProvider reactComponentContainer={reactComponentContainer}>
				{[python, r].map(instance =>
					<VariablesInstance
						key={instance.session.sessionId}
						active={instance === r}
						height={200}
						positronVariablesInstance={instance}
						reactComponentContainer={reactComponentContainer}
						width={400}
					/>
				)}
			</PositronVariablesContextProvider>
		);

		expect(screen.getByTestId('variables-python')).toHaveAttribute('inert');
		expect(screen.getByTestId('variables-r')).not.toHaveAttribute('inert');
	});
});
