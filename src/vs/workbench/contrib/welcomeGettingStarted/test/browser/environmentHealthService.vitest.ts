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

	/**
	 * Builds the service and opens a welcome page on it, which is what the editor
	 * pane does. Construction alone starts nothing -- see the first test.
	 */
	const open = (page: object = pageA) => {
		const service = build();
		service.refreshForPage(page);
		return service;
	};

	it('checks nothing until a welcome page opens', async () => {
		// The editor pane takes this as a constructor dependency, and it is the
		// pane for the classic welcome page too. If construction started runs,
		// every user would activate the Python and R extensions on startup for a
		// card the feature flag keeps hidden.
		const tracker = build();
		await settle();
		expect(executeCommand).not.toHaveBeenCalled();
		expect(tracker.state.map(l => l.state.kind)).toEqual(['loading', 'loading']);
		tracker.dispose();
	});

	it('checks every visible language once a welcome page opens', async () => {
		const tracker = open();
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
		const tracker = open();
		await settle();
		tracker.refreshForPage(pageB);
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
		const tracker = open();
		await settle();
		tracker.refreshForPage(pageB);
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
		const tracker = open();
		await settle();
		// The second editor group, same page.
		tracker.refreshForPage(pageA);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'r.getEnvironmentHealth')).toHaveLength(1);
		tracker.dispose();
	});

	it('rechecks when a different page opens', async () => {
		// Closing the welcome page and opening it again makes a new editor input,
		// which is what tells this apart from a split.
		const tracker = open();
		await settle();
		tracker.refreshForPage(pageB);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'r.getEnvironmentHealth')).toHaveLength(2);
		tracker.dispose();
	});

	it('does not start a second run while one is in flight', async () => {
		const tracker = open();
		tracker.refresh('python');
		tracker.refresh('python');
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(1);
		tracker.dispose();
	});

	it('keeps the previous result on screen while refreshing, then replaces it', async () => {
		const tracker = open();
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
		const tracker = open();
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

	it('does not show a result the queued recheck exists to replace', async () => {
		// The check was already running when the fix ran, so its answer predates
		// the fix. Publishing it put the pre-fix failure back on screen for the
		// seconds the recheck took.
		const tracker = open();
		await settle();
		let resolveStale: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve; }));
		tracker.refresh('python');
		await settle();

		executeCommand.mockResolvedValue(passing);
		void tracker.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		await settle();

		// Every state the card would render, not just the last one: the stale
		// result is replaced within seconds, so asserting the final state alone
		// passes whether or not it was ever shown.
		const seen: (string | undefined)[] = [];
		const subscription = tracker.onDidChange(snapshot => seen.push(summaryOf(snapshot[0].state)));

		// The in-flight check, started before the fix, comes back failing.
		resolveStale(failing);
		await settle();
		expect(seen).not.toContain('No supported Python was found');
		expect(summaryOf(tracker.state[0].state)).toBe('Positron can discover Python environments');
		subscription.dispose();
		tracker.dispose();
	});

	it('reports a language as no longer running once its hidden run ends', async () => {
		// isRunning is not observable on its own, so a consumer mirrors it off
		// onDidChange. Ending a hidden run without firing left the card busy
		// forever, and its Recheck control dead for the other language too.
		const tracker = open();
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
		const tracker = open();
		await settle();
		expect(tracker.state.map(l => l.state.kind)).toEqual(['result', 'result']);
		tracker.dispose();
	});

	it('drops a result that arrives after its language was hidden mid-run', async () => {
		const tracker = open();
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
		const tracker = open();
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
		const tracker = open();
		await settle();
		expect(tracker.state.find(l => l.language === 'r')!.state.kind).toBe('unavailable');
		expect(executeCommand.mock.calls.map(c => c[0])).not.toContain('r.getEnvironmentHealth');
		tracker.dispose();
	});

	it('reports a rejected command as an error and logs the message', async () => {
		executeCommand.mockRejectedValue(new Error('ENOENT'));
		const tracker = open();
		await settle();
		expect(tracker.state[0].state).toEqual({ kind: 'error' });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Environment setup check failed for python: '));
		tracker.dispose();
	});

	it('reports a malformed payload as an error', async () => {
		executeCommand.mockResolvedValue({ ok: true, items: [] });
		const tracker = open();
		await settle();
		expect(tracker.state[0].state).toEqual({ kind: 'error' });
		tracker.dispose();
	});

	it('marks a language hidden from the setting and never checks it', async () => {
		getValue.mockReturnValue(['python']);
		const tracker = open();
		await settle();
		expect(tracker.state.map(l => l.state.kind)).toEqual(['result', 'hidden']);
		expect(executeCommand.mock.calls.map(c => c[0])).not.toContain('r.getEnvironmentHealth');
		tracker.dispose();
	});

	it('checks a language that the setting starts including', async () => {
		getValue.mockReturnValue(['python']);
		const tracker = open();
		await settle();
		getValue.mockReturnValue(['python', 'r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toContain('r.getEnvironmentHealth');
		tracker.dispose();
	});

	it('reports the language as running while its fix command is out', async () => {
		// A fix can run for minutes. The card takes its progress line from
		// isRunning, so a fix that does not report leaves the card looking idle
		// and its recheck control live.
		const tracker = open();
		await settle();
		let resolveFix: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveFix = resolve; }));
		const changed = vi.fn();
		const subscription = tracker.onDidChange(changed);

		void tracker.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		expect(tracker.isRunning('python')).toBe(true);
		expect(changed).toHaveBeenCalled();

		resolveFix(undefined);
		await settle();
		expect(tracker.isRunning('python')).toBe(false);
		subscription.dispose();
		tracker.dispose();
	});

	it('stops reporting the language as running when its fix command fails', async () => {
		const tracker = open();
		await settle();
		executeCommand.mockRejectedValueOnce(new Error('nope'));
		const changed = vi.fn();
		const subscription = tracker.onDidChange(changed);

		const running = tracker.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		// Drop the event that said the fix started, so what is asserted below is
		// the one that says it ended.
		changed.mockClear();

		await running;
		expect(tracker.isRunning('python')).toBe(false);
		// The card has to be told, or it keeps showing the progress line forever.
		expect(changed).toHaveBeenCalled();
		subscription.dispose();
		tracker.dispose();
	});

	it('runs a fix, then rechecks that language only', async () => {
		const tracker = open();
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
		const tracker = open();
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
