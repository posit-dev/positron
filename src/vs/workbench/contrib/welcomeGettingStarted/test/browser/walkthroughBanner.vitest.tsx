/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Event } from '../../../../../base/common/event.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IResolvedWalkthrough, IWalkthroughsService } from '../../browser/gettingStartedService.js';
import { WalkthroughBanner } from '../../browser/positronWelcomePage/components/walkthroughBanner.js';

/**
 * Builds a resolved walkthrough. Only `when` matters to the banner.
 * @param id The walkthrough id.
 * @returns A resolved walkthrough that applies to every window.
 */
const walkthrough = (id: string): IResolvedWalkthrough => ({
	id,
	title: id,
	description: '',
	order: 0,
	source: 'Built-In',
	isFeatured: false,
	when: ContextKeyExpr.true(),
	steps: [],
	icon: { type: 'icon', icon: Codicon.mortarBoard },
	walkthroughPageTitle: id,
	newItems: false,
	recencyBonus: 0,
	newEntry: false,
});

describe('WalkthroughBanner', () => {
	const executeCommand = vi.fn();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWalkthroughsService, {
			getWalkthroughs: () => [walkthrough('Setup'), walkthrough('Beginner')],
			onDidAddWalkthrough: Event.None,
			onDidRemoveWalkthrough: Event.None,
			onDidChangeWalkthrough: Event.None,
		})
		.stub(ICommandService, { executeCommand })
		// MockContextKeyService answers false to every `when` clause, which would
		// hide the banner outright.
		.stub(IContextKeyService, stubInterface<IContextKeyService>({ contextMatchesRules: () => true }))
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('names the banner and links to the walkthroughs', () => {
		rtl.render(<WalkthroughBanner />);

		expect(screen.getByRole('region', { name: 'Learn' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'See all walkthroughs' })).toBeInTheDocument();
	});

	it('opens the walkthrough list when clicked', async () => {
		const user = userEvent.setup();
		rtl.render(<WalkthroughBanner />);

		await user.click(screen.getByRole('button', { name: 'See all walkthroughs' }));

		expect(executeCommand).toHaveBeenCalledWith('welcome.showAllWalkthroughs');
	});
});
