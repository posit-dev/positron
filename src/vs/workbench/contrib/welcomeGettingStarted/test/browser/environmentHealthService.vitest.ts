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
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { GettingStartedInput } from '../../browser/gettingStartedInput.js';
import { ILanguageHealthSource } from '../../browser/positronWelcomePage/environmentHealth.js';
import { EnvironmentHealthService, LanguageHealthState } from '../../browser/positronWelcomePage/environmentHealthService.js';

const SOURCES: readonly ILanguageHealthSource[] = [
	{ language: 'python', label: 'Python', extensionId: 'ms-python.python', healthCheckCommandId: 'python.getEnvironmentHealth' },
	{ language: 'r', label: 'R', extensionId: 'positron.positron-r', healthCheckCommandId: 'r.getEnvironmentHealth' },
];

const passing = { ok: true, items: [{ id: 'discovery', status: 'pass', summary: 'Positron can discover Python environments' }] };
const failing = { ok: false, items: [{ id: 'discovery', status: 'fail', summary: 'No supported Python was found' }] };

/** The first item's summary, so a test can tell one result from another. */
const summaryOf = (state: LanguageHealthState) =>
	state.kind === 'result' ? state.result.items[0].summary : undefined;

/**
 * Stand-ins for the editor inputs the pane passes. The service only compares
 * them by identity, so these need no behaviour -- and stubInterface throws if it
 * ever starts reading one, which is worth knowing.
 */
const pageA = stubInterface<GettingStartedInput>();
const pageB = stubInterface<GettingStartedInput>();

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
	const open = (page: GettingStartedInput = pageA) => {
		const service = build();
		service.rerunChecksForPage(page);
		return service;
	};

	it('checks nothing until a welcome page opens', async () => {
		// The editor pane takes this as a constructor dependency, and it is the
		// pane for the classic welcome page too. If construction started runs,
		// every user would activate the Python and R extensions on startup for a
		// card the feature flag keeps hidden.
		const environmentHealthService = build();
		await settle();
		expect(executeCommand).not.toHaveBeenCalled();
		expect(environmentHealthService.state.map(l => l.state.kind)).toEqual(['loading', 'loading']);
		environmentHealthService.dispose();
	});

	it('checks every visible language once a welcome page opens', async () => {
		const environmentHealthService = open();
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'python.getEnvironmentHealth',
			'r.getEnvironmentHealth',
		]);
		expect(environmentHealthService.state.map(l => [l.language, l.state.kind])).toEqual([
			['python', 'result'],
			['r', 'result'],
		]);
		environmentHealthService.dispose();
	});

	it('reruns every visible language for a new page', async () => {
		const environmentHealthService = open();
		await settle();
		environmentHealthService.rerunChecksForPage(pageB);
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'python.getEnvironmentHealth',
			'r.getEnvironmentHealth',
			'python.getEnvironmentHealth',
			'r.getEnvironmentHealth',
		]);
		environmentHealthService.dispose();
	});

	it('leaves a hidden language alone when a page opens', async () => {
		getValue.mockReturnValue(['r']);
		const environmentHealthService = open();
		await settle();
		environmentHealthService.rerunChecksForPage(pageB);
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'r.getEnvironmentHealth',
			'r.getEnvironmentHealth',
		]);
		environmentHealthService.dispose();
	});

	it('does not rerun when the same page opens in a second editor group', async () => {
		// Splitting the editor builds a second pane for the same page. The pane
		// cannot tell that on its own -- a new pane remembers nothing -- so the
		// service holds the memory. Without it, splitting pays for a full R
		// discovery, conda call included.
		const environmentHealthService = open();
		await settle();
		// The second editor group, same page.
		environmentHealthService.rerunChecksForPage(pageA);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'r.getEnvironmentHealth')).toHaveLength(1);
		environmentHealthService.dispose();
	});

	it('reruns when a different page opens', async () => {
		// Closing the welcome page and opening it again makes a new editor input,
		// which is what tells this apart from a split.
		const environmentHealthService = open();
		await settle();
		environmentHealthService.rerunChecksForPage(pageB);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'r.getEnvironmentHealth')).toHaveLength(2);
		environmentHealthService.dispose();
	});

	it('does not start a second run while one is in flight', async () => {
		const environmentHealthService = open();
		environmentHealthService.rerunCheckForLanguage('python');
		environmentHealthService.rerunCheckForLanguage('python');
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(1);
		environmentHealthService.dispose();
	});

	it('keeps the previous result on screen while refreshing, then replaces it', async () => {
		const environmentHealthService = open();
		await settle();
		let resolveSecond: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
		environmentHealthService.rerunCheckForLanguage('python');
		// The run suspends on the extension-presence check first, so without this
		// executeCommand has not been called and resolveSecond is still the
		// placeholder -- resolving it would do nothing and the test would pass
		// whatever the refresh did.
		await settle();
		expect(environmentHealthService.state[0].state.kind).toBe('result');
		expect(environmentHealthService.isBusy('python')).toBe(true);

		resolveSecond(failing);
		await settle();
		expect(summaryOf(environmentHealthService.state[0].state)).toBe('No supported Python was found');
		expect(environmentHealthService.isBusy('python')).toBe(false);
		environmentHealthService.dispose();
	});

	it('runs a rerun asked for while a run was already in flight', async () => {
		// A fix reruns the language it fixed. A fix that resolves while an
		// earlier check is still out used to have its rerun dropped, leaving the
		// card showing the result from before the fix ran.
		const environmentHealthService = open();
		await settle();
		let resolveFirst: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
		environmentHealthService.rerunCheckForLanguage('python');
		await settle();

		void environmentHealthService.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(2);

		executeCommand.mockResolvedValue(failing);
		resolveFirst(passing);
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(3);
		expect(summaryOf(environmentHealthService.state[0].state)).toBe('No supported Python was found');
		environmentHealthService.dispose();
	});

	it('does not show a result the queued rerun exists to replace', async () => {
		// The check was already running when the fix ran, so its answer predates
		// the fix. Publishing it put the pre-fix failure back on screen for the
		// seconds the rerun took.
		const environmentHealthService = open();
		await settle();
		let resolveStale: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve; }));
		environmentHealthService.rerunCheckForLanguage('python');
		await settle();

		executeCommand.mockResolvedValue(passing);
		void environmentHealthService.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		await settle();

		// Every state the card would render, not just the last one: the stale
		// result is replaced within seconds, so asserting the final state alone
		// passes whether or not it was ever shown.
		const seen: (string | undefined)[] = [];
		const subscription = environmentHealthService.onDidChange(snapshot => seen.push(summaryOf(snapshot[0].state)));

		// The in-flight check, started before the fix, comes back failing.
		resolveStale(failing);
		await settle();
		expect(seen).not.toContain('No supported Python was found');
		expect(summaryOf(environmentHealthService.state[0].state)).toBe('Positron can discover Python environments');
		subscription.dispose();
		environmentHealthService.dispose();
	});

	it('stops reporting a language as busy when its fix ends after it was hidden', async () => {
		// The rerun after a fix returns at its own disabled-language guard, so
		// without firing here the card keeps a progress line up for a language it
		// is no longer showing -- and its rerun control stays dead.
		const environmentHealthService = open();
		await settle();
		let resolveFix: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveFix = resolve; }));
		void environmentHealthService.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		expect(environmentHealthService.isBusy('python')).toBe(true);

		getValue.mockReturnValue(['r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		const changed = vi.fn();
		const subscription = environmentHealthService.onDidChange(changed);

		resolveFix(undefined);
		await settle();
		expect(environmentHealthService.isBusy('python')).toBe(false);
		expect(changed).toHaveBeenCalled();
		subscription.dispose();
		environmentHealthService.dispose();
	});

	it('stays busy for a fix after a check for the same language ends', async () => {
		// Checks and fixes are tracked separately for this reason: one set would
		// mean the check ending cleared the flag while the fix was still running.
		const environmentHealthService = open();
		await settle();
		let resolveFix: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveFix = resolve; }));
		void environmentHealthService.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });

		// A check for the same language runs and finishes while the fix is out. It
		// has to actually run: sharing one set would make this request look like a
		// duplicate of the fix and drop it, which would pass the busy assertions
		// below for the wrong reason.
		environmentHealthService.rerunCheckForLanguage('python');
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(2);
		expect(environmentHealthService.isBusy('python')).toBe(true);

		resolveFix(undefined);
		await settle();
		expect(environmentHealthService.isBusy('python')).toBe(false);
		environmentHealthService.dispose();
	});

	it('reports a language as no longer running once its hidden run ends', async () => {
		// isBusy is not observable on its own, so a consumer mirrors it off
		// onDidChange. Ending a hidden run without firing left the card busy
		// forever, and its rerun control dead for the other language too.
		const environmentHealthService = open();
		await settle();
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
		environmentHealthService.rerunCheckForLanguage('python');
		await settle();

		getValue.mockReturnValue(['r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		const changed = vi.fn();
		const subscription = environmentHealthService.onDidChange(changed);

		resolveRun(passing);
		await settle();
		expect(environmentHealthService.isBusy('python')).toBe(false);
		expect(changed).toHaveBeenCalled();
		subscription.dispose();
		environmentHealthService.dispose();
	});

	it('falls back to the default when the setting is not an array', async () => {
		// settings.json is hand-edited. A non-array value used to throw out of the
		// constructor, which took the whole welcome page down with it.
		getValue.mockReturnValue(true);
		const environmentHealthService = open();
		await settle();
		expect(environmentHealthService.state.map(l => l.state.kind)).toEqual(['result', 'result']);
		environmentHealthService.dispose();
	});

	it('drops a result that arrives after its language was hidden mid-run', async () => {
		const environmentHealthService = open();
		await settle();
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
		environmentHealthService.rerunCheckForLanguage('python');
		// Let the extension-presence check resolve, so executeCommand (and
		// resolveRun) is actually captured before it is used below.
		await settle();
		expect(environmentHealthService.isBusy('python')).toBe(true);

		// The user hides python while its check is still running.
		getValue.mockReturnValue(['r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		expect(environmentHealthService.state[0].state.kind).toBe('hidden');

		resolveRun(passing);
		await settle();

		expect(environmentHealthService.state[0].state.kind).toBe('hidden');
		expect(environmentHealthService.isBusy('python')).toBe(false);
		environmentHealthService.dispose();
	});

	it('clears isBusy before firing the change event, so the two never disagree', async () => {
		const environmentHealthService = open();
		await settle();
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
		environmentHealthService.rerunCheckForLanguage('python');
		// Let the extension-presence check resolve, so executeCommand (and
		// resolveRun) is actually captured before it is used below.
		await settle();

		let runningWhenFired: boolean | undefined;
		const subscription = environmentHealthService.onDidChange(() => {
			runningWhenFired = environmentHealthService.isBusy('python');
		});
		resolveRun(passing);
		await settle();

		expect(runningWhenFired).toBe(false);
		subscription.dispose();
		environmentHealthService.dispose();
	});

	it('reports a missing extension without calling its command', async () => {
		getExtension.mockImplementation(async (id: string) => id === 'positron.positron-r' ? undefined : {});
		const environmentHealthService = open();
		await settle();
		expect(environmentHealthService.state.find(l => l.language === 'r')!.state.kind).toBe('unavailable');
		expect(executeCommand.mock.calls.map(c => c[0])).not.toContain('r.getEnvironmentHealth');
		environmentHealthService.dispose();
	});

	it('reports a rejected command as an error and logs the message', async () => {
		executeCommand.mockRejectedValue(new Error('ENOENT'));
		const environmentHealthService = open();
		await settle();
		expect(environmentHealthService.state[0].state).toEqual({ kind: 'error' });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('python: check failed: '));
		environmentHealthService.dispose();
	});

	it('reports a malformed payload as an error', async () => {
		executeCommand.mockResolvedValue({ ok: true, items: [] });
		const environmentHealthService = open();
		await settle();
		expect(environmentHealthService.state[0].state).toEqual({ kind: 'error' });
		environmentHealthService.dispose();
	});

	it('marks a language hidden from the setting and never checks it', async () => {
		getValue.mockReturnValue(['python']);
		const environmentHealthService = open();
		await settle();
		expect(environmentHealthService.state.map(l => l.state.kind)).toEqual(['result', 'hidden']);
		expect(executeCommand.mock.calls.map(c => c[0])).not.toContain('r.getEnvironmentHealth');
		environmentHealthService.dispose();
	});

	it('checks a language that the setting starts including', async () => {
		getValue.mockReturnValue(['python']);
		const environmentHealthService = open();
		await settle();
		getValue.mockReturnValue(['python', 'r']);
		onDidChangeConfiguration.fire({ affectsConfiguration: () => true });
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toContain('r.getEnvironmentHealth');
		environmentHealthService.dispose();
	});

	it('reports the language as running while its fix command is out', async () => {
		// A fix can run for minutes. The card takes its progress line from
		// isBusy, so a fix that does not report leaves the card looking idle
		// and its rerun control live.
		const environmentHealthService = open();
		await settle();
		let resolveFix: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveFix = resolve; }));
		const changed = vi.fn();
		const subscription = environmentHealthService.onDidChange(changed);

		void environmentHealthService.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		expect(environmentHealthService.isBusy('python')).toBe(true);
		expect(changed).toHaveBeenCalled();

		resolveFix(undefined);
		await settle();
		expect(environmentHealthService.isBusy('python')).toBe(false);
		subscription.dispose();
		environmentHealthService.dispose();
	});

	it('stops reporting the language as running when its fix command fails', async () => {
		const environmentHealthService = open();
		await settle();
		executeCommand.mockRejectedValueOnce(new Error('nope'));
		const changed = vi.fn();
		const subscription = environmentHealthService.onDidChange(changed);

		const running = environmentHealthService.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		// Drop the event that said the fix started, so what is asserted below is
		// the one that says it ended.
		changed.mockClear();

		await running;
		expect(environmentHealthService.isBusy('python')).toBe(false);
		// The card has to be told, or it keeps showing the progress line forever.
		expect(changed).toHaveBeenCalled();
		subscription.dispose();
		environmentHealthService.dispose();
	});

	it('runs a fix, then reruns that language only', async () => {
		const environmentHealthService = open();
		await settle();
		executeCommand.mockClear();
		await environmentHealthService.runFix('python', { commandId: 'python.installPythonViaUv', label: 'Install Python' });
		await settle();
		expect(executeCommand.mock.calls.map(c => c[0])).toEqual([
			'python.installPythonViaUv',
			'python.getEnvironmentHealth',
		]);
		environmentHealthService.dispose();
	});

	it('drops a result that arrives after disposal', async () => {
		let resolveRun: (value: unknown) => void = () => { };
		executeCommand.mockImplementation(() => new Promise(resolve => { resolveRun = resolve; }));
		const environmentHealthService = open();
		// Same reason as above: without this the run has not reached
		// executeCommand, so resolveRun is a no-op and nothing is being tested.
		await settle();
		environmentHealthService.dispose();

		resolveRun(passing);
		await settle();
		// Asserting on the state, not on a listener: the emitter is already dead
		// once disposed, so a silent listener proves nothing about the guard in
		// _set that this test exists to cover.
		expect(environmentHealthService.state.map(l => l.state.kind)).toEqual(['loading', 'loading']);
	});

	it('returns a fresh array from state so React sees the change', async () => {
		const environmentHealthService = build();
		expect(environmentHealthService.state).not.toBe(environmentHealthService.state);
		environmentHealthService.dispose();
	});
});
