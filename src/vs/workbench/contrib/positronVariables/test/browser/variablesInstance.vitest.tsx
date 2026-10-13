/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
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
