/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IHoverService } from '../../../hover/browser/hover.js';
import { IHoverManager } from '../../../hover/browser/hoverManager.js';
import { PositronHoverManagerContext, usePositronHoverManager } from '../../browser/usePositronHoverManager.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';

/**
 * Probe component: shows its tooltip through whichever hover manager the hook resolves.
 */
const Probe = (props: { hoverManager?: IHoverManager }) => {
	const hoverManager = usePositronHoverManager(props.hoverManager);
	return (
		<button onMouseEnter={e => hoverManager?.showHover(e.currentTarget, 'Probe tooltip')}>
			Probe
		</button>
	);
};

const makeHoverManager = () => ({ showHover: vi.fn(), hideHover: vi.fn() } satisfies IHoverManager);

describe('usePositronHoverManager', () => {
	const showInstantHover = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IHoverService, { showInstantHover, hideHover: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		showInstantHover.mockClear();
	});

	it('uses the hover manager it is given', async () => {
		const given = makeHoverManager();
		rtl.render(<Probe hoverManager={given} />);
		await userEvent.setup().hover(screen.getByRole('button', { name: 'Probe' }));
		expect(given.showHover).toHaveBeenCalledWith(expect.any(HTMLElement), 'Probe tooltip');
	});

	it('uses the hover manager from context when none is given', async () => {
		const fromContext = makeHoverManager();
		rtl.render(
			<PositronHoverManagerContext.Provider value={fromContext}>
				<Probe />
			</PositronHoverManagerContext.Provider>
		);
		await userEvent.setup().hover(screen.getByRole('button', { name: 'Probe' }));
		expect(fromContext.showHover).toHaveBeenCalledWith(expect.any(HTMLElement), 'Probe tooltip');
	});

	it('prefers the given hover manager over the one from context', async () => {
		const given = makeHoverManager();
		const fromContext = makeHoverManager();
		rtl.render(
			<PositronHoverManagerContext.Provider value={fromContext}>
				<Probe hoverManager={given} />
			</PositronHoverManagerContext.Provider>
		);
		await userEvent.setup().hover(screen.getByRole('button', { name: 'Probe' }));
		expect(given.showHover).toHaveBeenCalled();
		expect(fromContext.showHover).not.toHaveBeenCalled();
	});

	it('does not create its own hover manager when one is given or in context', async () => {
		const given = makeHoverManager();
		rtl.render(
			<PositronHoverManagerContext.Provider value={makeHoverManager()}>
				<Probe hoverManager={given} />
				<Probe />
			</PositronHoverManagerContext.Provider>
		);
		const user = userEvent.setup();
		for (const button of screen.getAllByRole('button', { name: 'Probe' })) {
			await user.hover(button);
		}
		// Wait past any hover delay: an own manager would have reached the hover service.
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(showInstantHover).not.toHaveBeenCalled();
	});

	it('creates its own hover manager when neither is available', async () => {
		rtl.render(<Probe />);
		await userEvent.setup().hover(screen.getByRole('button', { name: 'Probe' }));
		await waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
			expect.objectContaining({ content: 'Probe tooltip' }),
			false
		));
	});
});
