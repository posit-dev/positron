/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Emitter } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IPositronLayoutService } from '../../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { LayoutCards } from '../../browser/positronWelcomePage/components/layoutCards.js';

/**
 * Builds the services for the cards, with the simplified layout setting on or off.
 * @param simplifiedLayout The value of the simplified layout setting.
 */
function setup(simplifiedLayout: boolean) {
	const executeCommand = vi.fn();
	const publicLog2 = vi.fn();
	const onDidChangeCurrentLayout = new Emitter<string | undefined>();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IConfigurationService, new TestConfigurationService({ workbench: { experimental: { simplifiedLayout } } }))
		.stub(ICommandService, { executeCommand })
		.stub(ITelemetryService, { publicLog2 })
		.stub(IPositronLayoutService, {
			currentLayoutId: 'workbench.action.positronSimplifiedLayout',
			onDidChangeCurrentLayout: onDidChangeCurrentLayout.event,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);
	return { executeCommand, publicLog2, onDidChangeCurrentLayout, rtl };
}

describe('LayoutCards with the simplified layout on', () => {
	const { executeCommand, publicLog2, onDidChangeCurrentLayout, rtl } = setup(true);

	it('shows a card for each layout', () => {
		rtl.render(<LayoutCards />);

		expect(screen.getByRole('region', { name: 'Choose a Layout' })).toBeInTheDocument();
		expect(screen.getAllByRole('radio')).toHaveLength(4);
		for (const name of ['Simplified', 'Stacked', 'Side by Side', 'Notebook']) {
			expect(screen.getByRole('radio', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
		}
	});

	it('marks the layout the window is in, and follows it when it changes', () => {
		rtl.render(<LayoutCards />);

		expect(screen.getByRole('radio', { name: /^Simplified/ })).toBeChecked();
		expect(screen.getByRole('radio', { name: /^Stacked/ })).not.toBeChecked();

		act(() => onDidChangeCurrentLayout.fire(undefined));

		expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
	});

	it('applies the layout and logs the click', async () => {
		const user = userEvent.setup();
		rtl.render(<LayoutCards />);

		await user.click(screen.getByRole('radio', { name: /^Stacked/ }));

		expect(executeCommand).toHaveBeenCalledWith('workbench.action.positronFourPaneDataScienceLayout');
		expect(publicLog2).toHaveBeenCalledWith('gettingStarted.ActionExecuted', {
			command: 'welcomeLayoutCard',
			argument: 'workbench.action.positronFourPaneDataScienceLayout',
			walkthroughId: undefined,
		});
	});
});

describe('LayoutCards with the simplified layout off', () => {
	const { rtl } = setup(false);

	it('shows nothing', () => {
		rtl.render(<LayoutCards />);

		expect(screen.queryByRole('region', { name: 'Choose a Layout' })).not.toBeInTheDocument();
	});
});
