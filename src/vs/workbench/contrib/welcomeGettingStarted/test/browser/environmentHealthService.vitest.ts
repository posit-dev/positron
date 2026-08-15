/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ILanguageHealthSource } from '../../browser/positronWelcomePage/environmentHealth.js';
import { EnvironmentHealthService, LanguageHealthState } from '../../browser/positronWelcomePage/environmentHealthService.js';

const SOURCES: readonly ILanguageHealthSource[] = [
	{ language: 'python', label: 'Python', extensionId: 'ms-python.python', commandId: 'python.getEnvironmentHealth' },
	{ language: 'r', label: 'R', extensionId: 'positron.positron-r', commandId: 'r.getEnvironmentHealth' },
];

const passing = { ok: true, items: [{ id: 'discovery', status: 'pass', summary: 'Positron can discover Python environments' }] };
const failing = { ok: false, items: [{ id: 'discovery', status: 'fail', summary: 'No supported Python was found' }] };

/** The first item's summary, so a test can tell one result from another. */
const summaryOf = (state: LanguageHealthState) =>
	state.kind === 'result' ? state.result.items[0].summary : undefined;

/** Stand-ins for the editor inputs the pane passes; compared by identity. */
const pageA = {};
const pageB = {};

/** Resolves once every pending promise callback has run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('EnvironmentHealthService', () => {
	const onDidChangeConfiguration = new Emitter<{ affectsConfiguration: (key: string) => boolean }>();
	const executeCommand = vi.fn();
	const getExtension = vi.fn();
	const getValue = vi.fn();
	const warn = vi.fn();
	const trace = vi.fn();

	const ctx = createTestContainer()
		.stub(ICommandService, { executeCommand })
		.stub(IExtensionService, { getExtension })
		.stub(IConfigurationService, { getValue, onDidChangeConfiguration: onDidChangeConfiguration.event })
		.stub(ILogService, { trace, warn })
		.build();

	beforeEach(() => {
		vi.resetAllMocks();
		getValue.mockReturnValue(['python', 'r']);
		getExtension.mockResolvedValue({ identifier: { value: 'stub' } });
		executeCommand.mockResolvedValue(passing);
	});

	const build = () => ctx.instantiationService.createInstance(EnvironmentHealthService, SOURCES);

	it('checks every visible language once on construction', async () => {
		const tracker = build();
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'python.getEnvironmentHealth',
			'r.getEnvironmentHealth',
		]);
		expect(tracker.state.map(l => [l.language, l.state.kind])).toEqual([
			['python', 'result'],
			['r', 'result'],
		]);
		tracker.dispose();
	});

	it('does nothing when refreshForPage runs right after construction', async () => {
		// The pane calls refreshAll whenever it builds the page, and the first of
		// those calls is what builds the service. Its checks are already in flight
		// by then, so this must not start a second pair.
		const tracker = build();
		tracker.refreshForPage(pageA);
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'python.getEnvironmentHealth',
			'r.getEnvironmentHealth',
		]);
		tracker.dispose();
	});

	it('rechecks every visible language for a new page', async () => {
		const tracker = build();
		await settle();
		tracker.refreshForPage(pageA);
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'python.getEnvironmentHealth',
			'r.getEnvironmentHealth',
			'python.getEnvironmentHealth',
			'r.getEnvironmentHealth',
		]);
		tracker.dispose();
	});

	it('leaves a hidden language alone when a page opens', async () => {
		getValue.mockReturnValue(['r']);
		const tracker = build();
		await settle();
		tracker.refreshForPage(pageA);
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'r.getEnvironmentHealth',
			'r.getEnvironmentHealth',
		]);
		tracker.dispose();
	});

	it('does not recheck when the same page opens in a second editor group', async () => {
		// Splitting the editor builds a second pane for the same page. The pane
		// cannot tell that on its own -- a new pane remembers nothing -- so the
		// service holds the memory. Without it, splitting pays for a full R
		// discovery, conda call included.
		const tracker = build();
		await settle();
		tracker.refreshForPage(pageA);
		await settle();
		tracker.refreshForPage(pageA);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'r.getEnvironmentHealth')).toHaveLength(2);
		tracker.dispose();
	});

	it('rechecks when a different page opens', async () => {
		// Closing the welcome page and opening it again makes a new editor input,
		// which is what tells this apart from a split.
		const tracker = build();
		await settle();
		tracker.refreshForPage(pageA);
		await settle();
		tracker.refreshForPage(pageB);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'r.getEnvironmentHealth')).toHaveLength(3);
		tracker.dispose();
	});

	it('does not start a second run while one is in flight', async () => {
		const tracker = build();
		tracker.refresh('python');
		tracker.refresh('python');
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(1);
		tracker.dispose();
	});

	it('keeps the previous result on screen while refreshing, then replaces it', async () => {
		const tracker = build();
		await settle();
		let resolveSecond: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
		tracker.refresh('python');
		// The run suspends on the extension-presence check first, so without this
		// executeCommand has not been called and resolveSecond is still the
		// placeholder -- resolving it would do nothing and the test would pass
		// whatever the refresh did.
		await settle();
		expect(tracker.state[0].state.kind).toBe('result');
		expect(tracker.isRunning('python')).toBe(true);

		resolveSecond(failing);
		await settle();
		expect(summaryOf(tracker.state[0].state)).toBe('No supported Python was found');
		expect(tracker.isRunning('python')).toBe(false);
		tracker.dispose();
	});

	it('runs a recheck asked for while a run was already in flight', async () => {
		// A fix rechecks the language it fixed. A fix that resolves while an
		// earlier check is still out used to have its recheck dropped, leaving the
		// card showing the result from before the fix ran.
		const tracker = build();
		await settle();
		let resolveFirst: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
		tracker.refresh('python');
		await settle();

		void tracker.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(2);

		executeCommand.mockResolvedValue(failing);
		resolveFirst(passing);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(3);
		expect(summaryOf(tracker.state[0].state)).toBe('No supported Python was found');
		tracker.dispose();
	});

	it('reports a language as no longer running once its hidden run ends', async () => {
		// isRunning is not observable on its own, so a consumer mirrors it off
		// onDidChange. Ending a hidden run without firing left the card busy
		// forever, and its Recheck control dead for the other language too.
		const tracker = build();
		await settle();
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
		tracker.refresh('python');
		await settle();

		getValue.mockReturnValue(['r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		const changed = vi.fn();
		const subscription = tracker.onDidChange(changed);

		resolveRun(passing);
		await settle();
		expect(tracker.isRunning('python')).toBe(false);
		expect(changed).toHaveBeenCalled();
		subscription.dispose();
		tracker.dispose();
	});

	it('falls back to the default when the setting is not an array', async () => {
		// settings.json is hand-edited. A non-array value used to throw out of the
		// constructor, which took the whole welcome page down with it.
		getValue.mockReturnValue(true);
		const tracker = build();
		await settle();
		expect(tracker.state.map(l => l.state.kind)).toEqual(['result', 'result']);
		tracker.dispose();
	});

	it('drops a result that arrives after its language was hidden mid-run', async () => {
		const tracker = build();
		await settle();
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
		tracker.refresh('python');
		// Let the extension-presence check resolve, so executeCommand (and
		// resolveRun) is actually captured before it is used below.
		await settle();
		expect(tracker.isRunning('python')).toBe(true);

		// The user hides python while its check is still running.
		getValue.mockReturnValue(['r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		expect(tracker.state[0].state.kind).toBe('hidden');

		resolveRun(passing);
		await settle();

		expect(tracker.state[0].state.kind).toBe('hidden');
		expect(tracker.isRunning('python')).toBe(false);
		tracker.dispose();
	});

	it('clears isRunning before firing the change event, so the two never disagree', async () => {
		const tracker = build();
		await settle();
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
		tracker.refresh('python');
		// Let the extension-presence check resolve, so executeCommand (and
		// resolveRun) is actually captured before it is used below.
		await settle();

		let runningWhenFired: boolean | undefined;
		const subscription = tracker.onDidChange(() => {
			runningWhenFired = tracker.isRunning('python');
		});
		resolveRun(passing);
		await settle();

		expect(runningWhenFired).toBe(false);
		subscription.dispose();
		tracker.dispose();
	});

	it('reports a missing extension without calling its command', async () => {
		getExtension.mockImplementation(async (id: string) => id === 'positron.positron-r' ? undefined : {});
		const tracker = build();
		await settle();
		expect(tracker.state.find(l => l.language === 'r')!.state.kind).toBe('unavailable');
		expect(executeCommand.mock.calls.map(c => c[0])).not.toContain('r.getEnvironmentHealth');
		tracker.dispose();
	});

	it('reports a rejected command as an error and logs the message', async () => {
		executeCommand.mockRejectedValue(new Error('ENOENT'));
		const tracker = build();
		await settle();
		expect(tracker.state[0].state).toEqual({ kind: 'error' });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Environment setup check failed for python: '));
		tracker.dispose();
	});

	it('reports a malformed payload as an error', async () => {
		executeCommand.mockResolvedValue({ ok: true, items: [] });
		const tracker = build();
		await settle();
		expect(tracker.state[0].state).toEqual({ kind: 'error' });
		tracker.dispose();
	});

	it('marks a language hidden from the setting and never checks it', async () => {
		getValue.mockReturnValue(['python']);
		const tracker = build();
		await settle();
		expect(tracker.state.map(l => l.state.kind)).toEqual(['result', 'hidden']);
		expect(executeCommand.mock.calls.map(c => c[0])).not.toContain('r.getEnvironmentHealth');
		tracker.dispose();
	});

	it('checks a language that the setting starts including', async () => {
		getValue.mockReturnValue(['python']);
		const tracker = build();
		await settle();
		getValue.mockReturnValue(['python', 'r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toContain('r.getEnvironmentHealth');
		tracker.dispose();
	});

	it('runs a fix, then rechecks that language only', async () => {
		const tracker = build();
		await settle();
		executeCommand.mockClear();
		await tracker.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'python.installPythonViaUv',
			'python.getEnvironmentHealth',
		]);
		tracker.dispose();
	});

	it('drops a result that arrives after disposal', async () => {
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementation(() => new Promise(resolve => { resolveRun = resolve; }));
		const tracker = build();
		// Same reason as above: without this the run has not reached
		// executeCommand, so resolveRun is a no-op and nothing is being tested.
		await settle();
		tracker.dispose();

		resolveRun(passing);
		await settle();
		// Asserting on the state, not on a listener: the emitter is already dead
		// once disposed, so a silent listener proves nothing about the guard in
		// _set that this test exists to cover.
		expect(tracker.state.map(l => l.state.kind)).toEqual(['loading', 'loading']);
	});

	it('returns a fresh array from state so React sees the change', async () => {
		const tracker = build();
		expect(tracker.state).not.toBe(tracker.state);
		tracker.dispose();
	});
});
