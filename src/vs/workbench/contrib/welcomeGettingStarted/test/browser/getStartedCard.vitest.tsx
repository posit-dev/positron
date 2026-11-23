/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IPositronLayoutService } from '../../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { GetStartedCard } from '../../browser/positronWelcomePage/components/getStartedCard.js';
import { EnvironmentHealthLanguage } from '../../browser/positronWelcomePage/environmentHealth.js';
import { EnvironmentHealthSnapshot, IEnvironmentHealthService } from '../../browser/positronWelcomePage/environmentHealthService.js';
import { IAgentSetupState, WelcomeAgentSetup } from '../../browser/positronWelcomePage/welcomeAgentSetup.js';

const SIMPLIFIED = 'workbench.action.positronSimplifiedLayout';
const STACKED = 'workbench.action.positronFourPaneDataScienceLayout';
const SETUP_DONE_STORAGE_KEY = 'positron.welcome.getStarted.done';

/** Python passes every check; R has one warning. */
const environmentState: EnvironmentHealthSnapshot = [
	{
		language: 'python', label: 'Python', state: {
			kind: 'result', result: { ok: true, items: [{ id: 'installed', summary: 'Python is installed', status: 'pass' }] },
		},
	},
	{
		language: 'r', label: 'R', state: {
			kind: 'result', result: { ok: true, items: [{ id: 'renv', summary: 'renv is installed', status: 'warn' }] },
		},
	},
];

const environmentHealthService = stubInterface<IEnvironmentHealthService>({
	state: environmentState,
	onDidChange: Event.None,
	isBusy: () => false,
});

/**
 * Builds an agent setup stub: Posit Assistant installed, no provider signed in.
 * @param aiEnabled Whether AI features are on.
 */
function agentSetup(aiEnabled: boolean) {
	const state: IAgentSetupState = { aiEnabled, assistant: 'on', providerSignedIn: false, mcpServerEnabled: false };
	return stubInterface<WelcomeAgentSetup>({ state, onDidChange: Event.None });
}

describe('GetStartedCard', () => {
	const executeCommand = vi.fn();
	const publicLog2 = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.stub(ITelemetryService, { publicLog2 })
		.stub(IPositronLayoutService, { currentLayoutId: SIMPLIFIED, onDidChangeCurrentLayout: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const render = (available: boolean) => rtl.render(
		<GetStartedCard
			agentSetup={agentSetup(available)}
			environmentHealthService={environmentHealthService}
			expandedByLanguage={new Map<EnvironmentHealthLanguage, boolean>()}
		/>
	);

	beforeEach(() => {
		ctx.get(IStorageService).remove(SETUP_DONE_STORAGE_KEY, StorageScope.PROFILE);
	});

	it('walks through the environment, AI setup, and the layout', async () => {
		const user = userEvent.setup();
		render(true);

		expect(screen.getByRole('heading', { name: 'Check your environment' })).toBeInTheDocument();
		expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

		await user.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('heading', { name: 'Set up AI agents' })).toHaveFocus();
		expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('heading', { name: 'Choose a layout' })).toBeInTheDocument();
		expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Back' }));
		expect(screen.getByRole('heading', { name: 'Set up AI agents' })).toBeInTheDocument();
	});

	it('leaves out the AI step when AI features are off', async () => {
		const user = userEvent.setup();
		render(false);

		expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('heading', { name: 'Choose a layout' })).toBeInTheDocument();
	});

	it('starts the layout step on the current layout, and Finish applies a new pick', async () => {
		const user = userEvent.setup();
		render(false);
		await user.click(screen.getByRole('button', { name: 'Next' }));

		expect(screen.getByRole('radio', { name: /^Simplified/ })).toBeChecked();
		await user.click(screen.getByRole('radio', { name: /^Stacked/ }));
		expect(executeCommand).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: 'Finish' }));

		expect(executeCommand).toHaveBeenCalledWith(STACKED);
		expect(screen.getByRole('region', { name: 'Setup summary' })).toBeInTheDocument();
	});

	it('does not reapply the layout the window is already in', async () => {
		const user = userEvent.setup();
		render(false);
		await user.click(screen.getByRole('button', { name: 'Next' }));

		await user.click(screen.getByRole('button', { name: 'Finish' }));

		expect(executeCommand).not.toHaveBeenCalled();
	});

	it('sums up setup after Skip, and Review setup brings the steps back', async () => {
		const user = userEvent.setup();
		render(false);

		await user.click(screen.getByRole('button', { name: 'Skip setup' }));

		expect(screen.getByText('Python ready')).toBeInTheDocument();
		expect(screen.getByText('R: 1 fix left')).toBeInTheDocument();
		expect(screen.getByText('Layout: Simplified')).toBeInTheDocument();
		expect(screen.queryByText('Assistant: not set up')).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Review setup' }));

		expect(screen.getByRole('heading', { name: 'Check your environment' })).toBeInTheDocument();
	});

	it('says the Assistant is not set up when no provider is signed in', async () => {
		const user = userEvent.setup();
		render(true);

		await user.click(screen.getByRole('button', { name: 'Skip setup' }));

		expect(screen.getByText('Assistant: not set up')).toBeInTheDocument();
	});

	it('shows the summary when setup was finished before', () => {
		ctx.get(IStorageService).store(SETUP_DONE_STORAGE_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		render(false);

		expect(screen.getByRole('region', { name: 'Setup summary' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
	});
});
