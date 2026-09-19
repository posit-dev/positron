/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronHelpService } from '../../browser/positronHelpService.js';
import { ActionBars } from '../../browser/components/actionBars.js';

describe('Help ActionBars', () => {
	const showHelpTopicForForegroundSession = vi.fn<IPositronHelpService['showHelpTopicForForegroundSession']>().mockResolvedValue(true);
	const searchHelp = vi.fn<IPositronHelpService['searchHelp']>().mockResolvedValue(true);
	const getHelpTopics = vi.fn<IPositronHelpService['getHelpTopics']>().mockResolvedValue([
		{ label: 'plot', topic: 'graphics::plot', detail: 'graphics' },
		{ label: 'plot.lm', topic: 'stats::plot.lm', detail: 'stats' },
	]);
	const session = stubInterface<ILanguageRuntimeSession>({
		sessionId: 'r-session',
		runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'r', languageName: 'R' }),
	});
	const runtimeSessionService = stubInterface<IRuntimeSessionService>({
		foregroundSession: session,
		onDidChangeForegroundSession: Event.None,
	});
	const helpService = stubInterface<IPositronHelpService>({
		canNavigateBackward: false,
		canNavigateForward: false,
		currentHelpEntry: undefined,
		helpEntries: [],
		onDidChangeCurrentHelpEntry: Event.None,
		getHelpTopics,
		searchHelp,
		showHelpTopicForForegroundSession,
	});
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IRuntimeSessionService, runtimeSessionService)
		.stub(IPositronHelpService, helpService)
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);
	const componentContainer = stubInterface<IReactComponentContainer>({ onSizeChanged: Event.None });

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('places interpreter search in the first row and searches on Enter', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);

		const input = screen.getByRole('combobox', { name: 'Search R Help' });
		await user.type(input, 'linear model{Enter}');

		expect(searchHelp).toHaveBeenCalledWith('linear model');
		expect(input.closest('.positron-action-bar')?.querySelector('[aria-label="Previous topic"]')).not.toBeNull();
	});

	it('offers interpreter topics and opens a selected suggestion', async () => {
		const user = userEvent.setup();
		rtl.render(<ActionBars reactComponentContainer={componentContainer} onHome={() => { }} />);

		const input = screen.getByRole('combobox', { name: 'Search R Help' });
		await user.click(input);
		await user.type(input, 'plot');
		const option = await screen.findByRole('option', { name: /plot graphics/ });
		await user.click(option);

		expect(showHelpTopicForForegroundSession).toHaveBeenCalledWith('graphics::plot');
		expect(searchHelp).not.toHaveBeenCalled();
		expect(screen.queryByRole('listbox')).toBeNull();
	});
});
