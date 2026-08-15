/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as aria from '../../../../../base/browser/ui/aria/aria.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { EnvironmentHealthSnapshot, IEnvironmentHealthService } from '../../browser/positronWelcomePage/environmentHealthService.js';
import { EnvironmentHealthSection } from '../../browser/positronWelcomePage/components/environmentHealthSection.js';

describe('EnvironmentHealthSection', () => {
	const executeCommand = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ICommandService, { executeCommand })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);
	const onDidChange = new Emitter<EnvironmentHealthSnapshot>();

	const tracker = (snapshot: EnvironmentHealthSnapshot, overrides: Partial<IEnvironmentHealthService> = {}): IEnvironmentHealthService => ({
		_serviceBrand: undefined,
		onDidChange: onDidChange.event,
		get state() { return snapshot; },
		isBusy: () => false,
		refresh: vi.fn(),
		refreshForPage: vi.fn(),
		runFix: vi.fn(),
		...overrides,
	});

	const loading: EnvironmentHealthSnapshot = [
		{ language: 'python', label: 'Python', state: { kind: 'loading' } },
		{ language: 'r', label: 'R', state: { kind: 'loading' } },
	];

	it('names itself and renders a group per language', () => {
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker(loading)} />);
		expect(screen.getByRole('region', { name: 'Environment setup' })).toBeInTheDocument();
		expect(screen.getAllByRole('group')).toHaveLength(2);
	});

	it('rechecks every language when the control is pressed', async () => {
		const refresh = vi.fn();
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker(loading, { refresh })} />);
		await userEvent.setup().click(screen.getByRole('button', { name: 'Run the environment setup checks again' }));
		expect(refresh.mock.calls.map(c => c[0])).toEqual(['python', 'r']);
	});

	it('says it is busy with a progress bar, not by changing the button', async () => {
		// A spinner inside the button grew the header and shifted the card below
		// it, and the label swap put "Checking..." on screen twice. The bar sits
		// on the header's bottom edge, outside the text flow.
		const running = tracker(loading, { isBusy: () => true });
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={running} />);
		expect(screen.getByRole('progressbar', { name: 'Checking...' })).toBeInTheDocument();
		// The label never changes, so the control cannot move or resize, and it
		// stays reachable by keyboard rather than dropping out of the tab order.
		expect(screen.getByRole('button', { name: 'Run the environment setup checks again' })).toBeEnabled();
	});

	it('shows no progress bar once nothing is running', () => {
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker(loading)} />);
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
	});

	it('does not recheck while a run is in flight', async () => {
		const refresh = vi.fn();
		const running = tracker(loading, { isBusy: () => true, refresh });
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={running} />);
		await userEvent.setup().click(screen.getByRole('button', { name: 'Run the environment setup checks again' }));
		expect(refresh).not.toHaveBeenCalled();
	});

	it('announces a check the user starts, and says nothing about one already running', async () => {
		// The progress line is the only visual signal and a progressbar is not a
		// live region, so a run the user starts is otherwise silent. A run already
		// under way at mount is a different matter: the pane rebuilds this tree
		// whenever a walkthrough registers, and the live region is workbench-wide,
		// so announcing on mount speaks at someone working in another tab.
		const announce = vi.spyOn(aria, 'status').mockImplementation(() => { });
		let busy = false;
		// The snapshot React renders comes from the fired event, not from reading
		// `state` -- spreading the overrides copies that getter's value once, so an
		// override cannot make `state` change per read. Firing a new array is what
		// makes the component re-render.
		let snapshot = loading;
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker(loading, { get state() { return snapshot; }, isBusy: () => busy })} />);
		expect(announce).not.toHaveBeenCalled();

		busy = true;
		snapshot = [...loading];
		await act(async () => { onDidChange.fire(snapshot); });
		expect(announce).toHaveBeenCalledWith('Checking your environment setup');

		// The remount case, which is the one that matters: a rebuild while a check
		// happens to be running must not speak.
		announce.mockClear();
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker(loading, { isBusy: () => true })} />);
		expect(announce).not.toHaveBeenCalled();
		announce.mockRestore();
	});

	it('offers the setting once, from the header', async () => {
		// getByRole throws on a second match, which is the point: a row per
		// language repeated itself, and a row under the card read as a call to
		// action for turning the feature off, competing with the fix buttons.
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker(loading)} />);
		const gear = screen.getByRole('button', { name: 'Choose which languages are checked' });
		expect(gear.closest('.health-header')).toBeInTheDocument();
		await userEvent.setup().click(gear);
		expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'welcomePage.environmentChecks');
	});

	it('renders nothing for a language turned off in the setting', () => {
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker([
			{ language: 'python', label: 'Python', state: { kind: 'loading' } },
			{ language: 'r', label: 'R', state: { kind: 'hidden' } },
		])} />);
		expect(screen.getByText('Python')).toBeInTheDocument();
		expect(screen.queryByText('R')).not.toBeInTheDocument();
	});

	it('explains itself when every language is turned off', async () => {
		// With no groups there is nothing to recheck either, so both header
		// controls go. Turning the checks back on is the only thing left to do
		// here, so it gets the wording and the prominence the gear cannot carry.
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={tracker([
			{ language: 'python', label: 'Python', state: { kind: 'hidden' } },
			{ language: 'r', label: 'R', state: { kind: 'hidden' } },
		])} />);
		expect(screen.getByText('Environment setup checks are turned off for every language.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Run the environment setup checks again' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Choose which languages are checked' })).not.toBeInTheDocument();
		await userEvent.setup().click(screen.getByRole('button', { name: 'You can turn them back on in Settings' }));
		expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'welcomePage.environmentChecks');
	});

	it('re-renders when the tracker fires', async () => {
		let snapshot = loading;
		const live = tracker(loading, { get state() { return snapshot; } });
		rtl.render(<EnvironmentHealthSection expandedOverrides={new Map()} tracker={live} />);
		snapshot = [
			{ language: 'python', label: 'Python', state: { kind: 'unavailable' } },
			{ language: 'r', label: 'R', state: { kind: 'loading' } },
		];
		await act(async () => { onDidChange.fire(snapshot); });
		expect(screen.getByText('The Python extension is not available.')).toBeInTheDocument();
	});
});
