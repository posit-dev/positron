/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as aria from '../../../../../base/browser/ui/aria/aria.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IHealthItem } from '../../browser/positronWelcomePage/environmentHealth.js';
import { LanguageHealthState } from '../../browser/positronWelcomePage/environmentHealthTracker.js';
import { LanguageHealthGroup, userOverrides } from '../../browser/positronWelcomePage/components/languageHealthGroup.js';

const item = (status: IHealthItem['status'], summary: string): IHealthItem => ({ id: summary, status, summary });

const passing = { kind: 'result', result: { ok: true, items: [item('pass', 'A'), item('pass', 'B')] } } as const;
const failing = {
	kind: 'result',
	result: { ok: false, items: [item('pass', 'A'), item('fail', 'B'), item('skipped', 'C')] },
} as const;

describe('LanguageHealthGroup', () => {
	const executeCommand = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => vi.clearAllMocks());

	const render = (state: LanguageHealthState) =>
		rtl.render(<LanguageHealthGroup health={{ language: 'r', label: 'R', state }} onRunFix={vi.fn()} />);

	const header = () => screen.getByRole('button', { name: /^R/ });

	it('puts the count in the header, where the Hide control used to be', () => {
		render(failing);
		expect(header()).toHaveAccessibleName(/1 of 3 checks passed/);
	});

	it('opens itself when something needs attention', () => {
		// A fix button behind a collapsed header is a fix nobody finds.
		render(failing);
		expect(header()).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByText('B')).toBeInTheDocument();
	});

	it('stays shut when everything passed', () => {
		render(passing);
		expect(header()).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
	});

	it('shows every check once opened, passes included', async () => {
		render(passing);
		await userEvent.setup().click(header());
		expect(screen.getAllByRole('listitem')).toHaveLength(2);
	});

	it('lets the user overrule what it chose for them', async () => {
		render(failing);
		await userEvent.setup().click(header());
		expect(header()).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
	});

	beforeEach(() => userOverrides.clear());

	it('remembers a group the user closed across a remount', async () => {
		// The pane throws its React tree away whenever a walkthrough registers or
		// the tab is revisited. Held only in the component, the user's choice
		// would be lost and a failing group would spring back open.
		const health = { language: 'r', label: 'R', state: failing } as const;
		const { unmount } = rtl.render(<LanguageHealthGroup health={health} onRunFix={vi.fn()} />);
		// A failing group opens itself, so there is something to close.
		expect(screen.getByRole('list')).toBeInTheDocument();
		await userEvent.setup().click(screen.getByRole('button', { name: /R/ }));
		expect(screen.queryByRole('list')).not.toBeInTheDocument();

		unmount();
		rtl.render(<LanguageHealthGroup health={health} onRunFix={vi.fn()} />);
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
	});

	it('says nothing in the body while a first check runs', async () => {
		// The progress line in the card header is the only busy signal. A recheck
		// never reaches this state: the tracker keeps the previous result.
		render({ kind: 'loading' });
		expect(screen.queryByRole('button', { name: /^R/ })).not.toBeInTheDocument();
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
	});

	it.each([
		['unavailable', { kind: 'unavailable' }, 'The R extension is not available.'],
		['error', { kind: 'error' }, 'The R check could not be completed.'],
	] as const)('says the %s state once, in the header, with no chevron', (_label, state, expected) => {
		// These have nothing behind a disclosure, so the header is not a button
		// and the message is not repeated below it.
		render(state);
		expect(screen.getByText(expected)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^R/ })).not.toBeInTheDocument();
	});

	it('puts show-file-icons on the group container so the language icon can paint', () => {
		render(passing);
		expect(screen.getByRole('group')).toHaveClass('show-file-icons');
	});

	it('announces the result when it arrives', async () => {
		const announce = vi.spyOn(aria, 'status').mockImplementation(() => { });
		const { rerender } = rtl.render(
			<LanguageHealthGroup health={{ language: 'r', label: 'R', state: { kind: 'loading' } }} onRunFix={vi.fn()} />);
		rerender(<LanguageHealthGroup health={{ language: 'r', label: 'R', state: passing }} onRunFix={vi.fn()} />);
		expect(announce).toHaveBeenCalledWith('R, You have successfully set up R');
		announce.mockRestore();
	});

	it('announces a recheck that finds nothing new', async () => {
		// Same wording, new state object. Keying the announcement on the text
		// alone left Recheck looking dead to a screen reader user on the one
		// environment most likely to be rechecked: a healthy one.
		const announce = vi.spyOn(aria, 'status').mockImplementation(() => { });
		const { rerender } = rtl.render(
			<LanguageHealthGroup health={{ language: 'r', label: 'R', state: passing }} onRunFix={vi.fn()} />);
		// Silent at mount: a result already on screen was announced when it
		// landed, and this tree is remounted whenever a walkthrough registers.
		expect(announce).not.toHaveBeenCalled();

		rerender(<LanguageHealthGroup
			health={{ language: 'r', label: 'R', state: { kind: 'result', result: { ok: true, items: [item('pass', 'A'), item('pass', 'B')] } } }}
			onRunFix={vi.fn()} />);
		expect(announce).toHaveBeenCalledTimes(1);
		announce.mockRestore();
	});
});
