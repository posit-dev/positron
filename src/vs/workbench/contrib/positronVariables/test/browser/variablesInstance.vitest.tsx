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
import { createWheelEvent } from '../../../../../test/vitest/vitestUtils.js';
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

	/**
	 * Renders one instance per session, stacked the way VariablesCore does, with only one active.
	 * @param sessionIds The session of each instance.
	 * @param activeSessionId The session whose instance is active.
	 */
	function renderInstances(sessionIds: string[], activeSessionId: string) {
		const reactComponentContainer = stubInterface<IReactComponentContainer>({
			onSaveScrollPosition: Event.None,
			onRestoreScrollPosition: Event.None,
		});
		const instances = sessionIds.map(sessionId => ctx.disposables.add(new TestPositronVariablesInstance(
			stubInterface<ILanguageRuntimeSession>({ sessionId }))));
		rtl.render(
			<PositronVariablesContextProvider reactComponentContainer={reactComponentContainer}>
				{instances.map(instance =>
					<VariablesInstance
						key={instance.session.sessionId}
						active={instance.session.sessionId === activeSessionId}
						height={200}
						positronVariablesInstance={instance}
						reactComponentContainer={reactComponentContainer}
						width={400}
					/>
				)}
			</PositronVariablesContextProvider>
		);
	}

	it('keeps wheel events from reaching the workbench, except ctrl + wheel', () => {
		renderInstances(['python'], 'python');
		const element = screen.getByTestId('variables-python');
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

	it('takes inactive instances out of the accessibility tree and tab order', () => {
		renderInstances(['python', 'r'], 'r');

		expect(screen.getByTestId('variables-python')).toHaveAttribute('inert');
		expect(screen.getByTestId('variables-r')).not.toHaveAttribute('inert');
	});
});
