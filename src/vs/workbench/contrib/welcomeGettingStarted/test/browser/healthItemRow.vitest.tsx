/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IHealthItem } from '../../browser/positronWelcomePage/environmentHealth.js';
import { HealthItemRow } from '../../browser/positronWelcomePage/components/healthItemRow.js';

// showCustomContextMenu renders a modal popup into the workbench DOM, which isn't what these
// tests are about -- the behavior under test is which entry the row offers and what it does when
// selected. Mocking the one module lets us read the entries straight off the call.
const { showCustomContextMenu } = vi.hoisted(() => ({ showCustomContextMenu: vi.fn() }));
vi.mock('../../../../browser/positronComponents/customContextMenu/customContextMenu.js', () => ({
	showCustomContextMenu,
}));

const item = (overrides: Partial<IHealthItem> = {}): IHealthItem => ({
	id: 'environmentReady',
	status: 'pass',
	summary: 'The environment is ready to use with Positron',
	...overrides,
});

describe('HealthItemRow', () => {
	const open = vi.fn();
	const writeText = vi.fn();
	const ctx = createTestContainer().withReactServices()
		.stub(IOpenerService, { open })
		.stub(IClipboardService, { writeText })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		showCustomContextMenu.mockClear();
	});

	it.each([
		['pass', 'Passed'],
		['warn', 'Needs attention'],
		['fail', 'Failed'],
		['skipped', 'Not checked'],
	] as const)('states %s as text, not only as an icon', (status, expected) => {
		rtl.render(<HealthItemRow busy={false} item={item({ status })} onRunFix={vi.fn()} />);
		// The icon is aria-hidden, so this text is the only thing a screen reader
		// gets. Querying by it fails if the row ever relies on colour alone.
		expect(screen.getByText(expected)).toBeInTheDocument();
	});

	it('renders the summary and the detail', () => {
		rtl.render(<HealthItemRow busy={false} item={item({ detail: 'No supported Python was found.' })} onRunFix={vi.fn()} />);
		expect(screen.getByText('The environment is ready to use with Positron')).toBeInTheDocument();
		expect(screen.getByText('No supported Python was found.')).toBeInTheDocument();
	});

	it('omits the fix button and the learn more link when the item has neither', () => {
		rtl.render(<HealthItemRow busy={false} item={item()} onRunFix={vi.fn()} />);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
		expect(screen.queryByRole('link')).not.toBeInTheDocument();
	});

	it('runs the fix when its button is pressed', async () => {
		const onRunFix = vi.fn();
		const fix = { commandId: 'python.installPythonViaUv', label: 'Install Python' };
		rtl.render(<HealthItemRow busy={false} item={item({ status: 'fail', fix })} onRunFix={onRunFix} />);
		await userEvent.setup().click(screen.getByRole('button', { name: 'Install Python' }));
		expect(onRunFix).toHaveBeenCalledWith(fix);
	});

	it('renders a learn more link when the item carries a url', () => {
		rtl.render(<HealthItemRow busy={false} item={item({ learnMoreUrl: 'https://positron.posit.co/r-installations' })} onRunFix={vi.fn()} />);
		expect(screen.getByRole('link')).toHaveAttribute('href', 'https://positron.posit.co/r-installations');
	});

	it('opens the learn more link through the opener service instead of navigating', async () => {
		rtl.render(<HealthItemRow busy={false} item={item({ learnMoreUrl: 'https://positron.posit.co/r-installations' })} onRunFix={vi.fn()} />);
		const link = screen.getByRole('link');
		// Capture the native event so we can check afterwards whether the
		// browser's own navigation (the event's default action) was prevented.
		let clickEvent: Event | undefined;
		link.addEventListener('click', e => { clickEvent = e; });
		await userEvent.setup().click(link);
		expect(open).toHaveBeenCalledWith(URI.parse('https://positron.posit.co/r-installations'));
		expect(clickEvent?.defaultPrevented).toBe(true);
	});

	it('does not run a fix twice while the first one is still going', async () => {
		// A fix command can run for minutes. Pressing it again would start a
		// second install, or create a second environment.
		const onRunFix = vi.fn();
		const fix = { commandId: 'python.createEnvironmentAndRegister', label: 'Create Python Environment' };
		rtl.render(<HealthItemRow
			busy={true}
			item={{ id: 'dedicated', status: 'fail', summary: 'No dedicated environment', fix }}
			onRunFix={onRunFix} />);
		const button = screen.getByRole('button', { name: 'Create Python Environment' });
		expect(button).toHaveAttribute('aria-disabled', 'true');
		// Marked unavailable rather than natively disabled, so it keeps its place
		// in the tab order: disabling a focused button drops the keyboard user to
		// the top of the page for the minutes an install takes.
		expect(button).toBeEnabled();
		await userEvent.setup().click(button);
		expect(onRunFix).not.toHaveBeenCalled();
	});

	it('renders no path when none is given', () => {
		rtl.render(<HealthItemRow busy={false} item={item()} onRunFix={vi.fn()} />);
		expect(screen.queryByText('/usr/bin/python3')).not.toBeInTheDocument();
	});

	it('renders the path when one is given', () => {
		rtl.render(<HealthItemRow busy={false} item={item()} path='/usr/bin/python3' onRunFix={vi.fn()} />);
		expect(screen.getByText('/usr/bin/python3')).toBeInTheDocument();
	});

	it('copies the path to the clipboard from its context menu', async () => {
		rtl.render(<HealthItemRow busy={false} item={item()} path='/usr/bin/python3' onRunFix={vi.fn()} />);
		const path = screen.getByText('/usr/bin/python3');
		await userEvent.setup().pointer({ keys: '[MouseRight]', target: path });

		const call = showCustomContextMenu.mock.calls.at(-1)?.[0];
		const copyEntry = call?.entries.find((entry: { options?: { label?: string } }) => entry.options?.label === 'Copy');
		expect(copyEntry).toBeDefined();
		await copyEntry.options.onSelected({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });

		expect(writeText).toHaveBeenCalledWith('/usr/bin/python3');
	});

	it('leaves a left click on the path alone', async () => {
		rtl.render(<HealthItemRow busy={false} item={item()} path='/usr/bin/python3' onRunFix={vi.fn()} />);
		await userEvent.setup().click(screen.getByText('/usr/bin/python3'));
		expect(showCustomContextMenu).not.toHaveBeenCalled();
	});
});
