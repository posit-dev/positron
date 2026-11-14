/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { TestPositronVariablesInstance } from '../../../../services/positronVariables/test/common/testPositronVariablesInstance.js';
import { PositronVariablesContextProvider } from '../../browser/positronVariablesContext.js';
import { VariablesEmpty } from '../../browser/components/variablesEmpty.js';

describe('VariablesEmpty', () => {
	const executeCommand = vi.fn();
	// The context reads the active instance from the service when it mounts, so
	// each test sets it here before rendering.
	const variablesService: { activePositronVariablesInstance: IPositronVariablesInstance | undefined } = {
		activePositronVariablesInstance: undefined,
	};
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(IPositronVariablesService, {
			positronVariablesInstances: [],
			get activePositronVariablesInstance() { return variablesService.activePositronVariablesInstance; },
			onDidStartPositronVariablesInstance: Event.None,
			onDidStopPositronVariablesInstance: Event.None,
			onDidChangeActivePositronVariablesInstance: Event.None,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		variablesService.activePositronVariablesInstance = undefined;
	});

	const render = (initializing: boolean, filterText = '') => {
		const instance = ctx.disposables.add(new TestPositronVariablesInstance(
			stubInterface<ILanguageRuntimeSession>({ sessionId: 'r' })));
		instance.setFilterText(filterText);
		variablesService.activePositronVariablesInstance = instance;
		const reactComponentContainer = stubInterface<IReactComponentContainer>({
			onSaveScrollPosition: Event.None,
			onRestoreScrollPosition: Event.None,
		});
		rtl.render(
			<PositronVariablesContextProvider reactComponentContainer={reactComponentContainer}>
				<VariablesEmpty initializing={initializing} />
			</PositronVariablesContextProvider>
		);
	};

	it('explains the pane and points at the tour when there are no variables', async () => {
		render(false);
		expect(screen.getByText('Variables created in your session appear here.')).toBeInTheDocument();
		expect(screen.getByText('Plots you create open in the Plots pane.')).toBeInTheDocument();
		await userEvent.setup().click(screen.getByRole('button', { name: 'Take a tour of the Positron UI' }));
		// Room is made first, so the walkthrough lays out in an editor of its final size.
		expect(executeCommand.mock.calls).toEqual([
			['workbench.action.minimizePanel'],
			['workbench.action.closeSidebar'],
			['workbench.action.openWalkthrough', 'positron.welcome'],
		]);
	});

	it('says only that the filter matched nothing when a filter is set', () => {
		// The tour is no help to someone who typed a filter that matched nothing.
		render(false, 'zzz');
		expect(screen.getByText('No variables match the current filter.')).toBeInTheDocument();
		expect(screen.queryByText('Variables created in your session appear here.')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Take a tour of the Positron UI' })).not.toBeInTheDocument();
	});

	it('shows no hints while the session is still starting', () => {
		render(true);
		expect(screen.getByText('...')).toBeInTheDocument();
		expect(screen.queryByText('Variables created in your session appear here.')).not.toBeInTheDocument();
	});
});
