/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IHoverService } from '../../../hover/browser/hover.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../test/vitest/reactTestingLibrary.js';
import { PositronActionBarContextProvider } from '../../browser/positronActionBarContext.js';
import { useActionBarHover } from '../../browser/useActionBarHover.js';

/**
 * A button that shows a hover through the hook under test.
 */
const HoverTarget = (props: { content: string }) => {
	const hover = useActionBarHover<HTMLButtonElement>(props.content);
	return <button {...hover}>Target</button>;
};

describe('useActionBarHover', () => {
	// Hiding the hover disposes the widget that showInstantHover returned.
	const disposeHover = vi.fn();
	const showInstantHover = vi.fn(() => ({ dispose: disposeHover }));
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IHoverService, { showInstantHover, hideHover: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// Show hovers without the default delay.
	beforeEach(() => (ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('workbench.hover.delay', 0));

	const renderTarget = (content: string) => rtl.render(
		<PositronActionBarContextProvider>
			<HoverTarget content={content} />
		</PositronActionBarContextProvider>
	);

	const expectHoverShown = (content: string) => waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
		expect.objectContaining({ content, target: screen.getByRole('button', { name: 'Target' }) }),
		false
	));

	it('shows the hover on mouse enter and hides it on mouse leave', async () => {
		const user = userEvent.setup();
		renderTarget('Tooltip');

		await user.hover(screen.getByRole('button', { name: 'Target' }));
		await expectHoverShown('Tooltip');

		await user.unhover(screen.getByRole('button', { name: 'Target' }));
		expect(disposeHover).toHaveBeenCalled();
	});

	it('shows the hover on focus and hides it on blur', async () => {
		const user = userEvent.setup();
		renderTarget('Tooltip');

		await user.tab();
		await expectHoverShown('Tooltip');

		await user.tab();
		expect(disposeHover).toHaveBeenCalled();
	});

	it('updates the hover when the content changes while it is showing', async () => {
		const user = userEvent.setup();
		const { rerender } = renderTarget('Before');

		await user.tab();
		await expectHoverShown('Before');

		rerender(
			<PositronActionBarContextProvider>
				<HoverTarget content='After' />
			</PositronActionBarContextProvider>
		);
		await expectHoverShown('After');
	});
});
