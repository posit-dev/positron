/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { CurrentWorkingDirectory } from '../../browser/components/currentWorkingDirectory.js';

// The real context menu renders a modal popup; the tests only need to know it was asked to open.
const { mockShowCustomContextMenu } = vi.hoisted(() => ({ mockShowCustomContextMenu: vi.fn() }));
vi.mock('../../../../browser/positronComponents/customContextMenu/customContextMenu.js', () => ({
	showCustomContextMenu: mockShowCustomContextMenu,
}));

describe('CurrentWorkingDirectory', () => {
	const showInstantHover = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IHoverService, { showInstantHover, hideHover: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// Show hovers without the default delay.
	beforeEach(() => (ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('workbench.hover.delay', 0));

	const renderLabel = () => rtl.render(
		<PositronActionBarContextProvider>
			<CurrentWorkingDirectory directoryLabel='~/projects/demo' />
		</PositronActionBarContextProvider>
	);

	it('is a focusable menu button whose name includes the directory', () => {
		renderLabel();

		const label = screen.getByRole('button', { name: 'Current Working Directory: ~/projects/demo' });
		expect(label).toHaveAttribute('aria-haspopup', 'menu');
		expect(label).toHaveAttribute('tabindex', '0');
	});

	it('shows the directory in a hover when it gets focus', async () => {
		const user = userEvent.setup();
		renderLabel();

		await user.tab();

		expect(screen.getByRole('button', { name: /current working directory/i })).toHaveFocus();
		await waitFor(() => expect(showInstantHover).toHaveBeenCalledWith(
			expect.objectContaining({ content: '~/projects/demo' }),
			false
		));
	});

	it('opens the copy menu at the pointer on right-click', async () => {
		const user = userEvent.setup();
		renderLabel();

		const label = screen.getByRole('button', { name: /current working directory/i });
		await user.pointer({ keys: '[MouseRight]', target: label, coords: { clientX: 30, clientY: 40 } });

		expect(mockShowCustomContextMenu).toHaveBeenCalledWith(expect.objectContaining({
			anchorElement: label,
			anchorPoint: { clientX: 30, clientY: 40 },
		}));
	});

	it('opens the copy menu anchored to the label on Shift+F10', async () => {
		const user = userEvent.setup();
		renderLabel();

		await user.tab();
		await user.keyboard('{Shift>}{F10}{/Shift}');

		expect(mockShowCustomContextMenu).toHaveBeenCalledWith(expect.objectContaining({
			anchorElement: screen.getByRole('button', { name: /current working directory/i }),
			anchorPoint: undefined,
		}));
	});

	it('opens the menu once when the browser also fires contextmenu after Shift+F10', async () => {
		const user = userEvent.setup();
		renderLabel();

		// Windows and Linux follow Shift+F10 with a contextmenu event; jsdom does not, so fire it.
		await user.tab();
		await user.keyboard('{Shift>}{F10}{/Shift}');
		fireEvent.contextMenu(screen.getByRole('button', { name: /current working directory/i }));

		expect(mockShowCustomContextMenu).toHaveBeenCalledTimes(1);
	});

	it('still opens the menu on a later right-click after Shift+F10', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			const user = userEvent.setup();
			renderLabel();

			// macOS fires no contextmenu after Shift+F10, so the next one is a real right-click.
			await user.tab();
			await user.keyboard('{Shift>}{F10}{/Shift}');
			vi.advanceTimersByTime(1000);
			await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: /current working directory/i }) });

			expect(mockShowCustomContextMenu).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('opens the copy menu on Enter', async () => {
		const user = userEvent.setup();
		renderLabel();

		await user.tab();
		await user.keyboard('{Enter}');

		expect(mockShowCustomContextMenu).toHaveBeenCalledTimes(1);
	});
});
