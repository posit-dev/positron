/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesContextProvider } from '../../browser/positronVariablesContext.js';
import { VariablesCore } from '../../browser/components/variablesCore.js';

describe('VariablesCore with no session', () => {
	const onDidChangeRuntimeStartupPhase = new Emitter<RuntimeStartupPhase>();
	const runtimeService = { startupPhase: RuntimeStartupPhase.Starting };
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ILanguageRuntimeService, {
			get startupPhase() { return runtimeService.startupPhase; },
			onDidChangeRuntimeStartupPhase: onDidChangeRuntimeStartupPhase.event,
		})
		.stub(IPositronVariablesService, {
			positronVariablesInstances: [],
			activePositronVariablesInstance: undefined,
			onDidStartPositronVariablesInstance: Event.None,
			onDidStopPositronVariablesInstance: Event.None,
			onDidChangeActivePositronVariablesInstance: Event.None,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const setPhase = (phase: RuntimeStartupPhase) => {
		runtimeService.startupPhase = phase;
		onDidChangeRuntimeStartupPhase.fire(phase);
	};

	const render = () => {
		const reactComponentContainer = stubInterface<IReactComponentContainer>({
			onSaveScrollPosition: Event.None,
			onRestoreScrollPosition: Event.None,
		});
		rtl.render(
			<PositronVariablesContextProvider reactComponentContainer={reactComponentContainer}>
				<VariablesCore height={400} reactComponentContainer={reactComponentContainer} width={300} />
			</PositronVariablesContextProvider>
		);
	};

	const hint = () => screen.queryByText('Variables created in your session appear here.');

	it('introduces the pane once startup finishes with no session', () => {
		// A window that ends startup with no session would otherwise show an
		// empty pane with nothing to say what it is for.
		setPhase(RuntimeStartupPhase.Starting);
		render();
		expect(hint()).not.toBeInTheDocument();

		act(() => setPhase(RuntimeStartupPhase.Complete));
		expect(hint()).toBeInTheDocument();
	});
});
