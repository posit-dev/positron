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
import { EnvironmentHealthTracker } from '../../browser/positronWelcomePage/environmentHealthTracker.js';

const SOURCES: readonly ILanguageHealthSource[] = [
	{ language: 'python', label: 'Python', extensionId: 'ms-python.python', commandId: 'python.getEnvironmentHealth' },
	{ language: 'r', label: 'R', extensionId: 'positron.positron-r', commandId: 'r.getEnvironmentHealth' },
];

const passing = { ok: true, items: [{ id: 'discovery', status: 'pass', summary: 'Positron can discover Python environments' }] };

/** Resolves once every pending promise callback has run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('EnvironmentHealthTracker', () => {
	const onDidChangeConfiguration = new Emitter<{ affectsConfiguration: (key: string) => boolean }>();
	const executeCommand = vi.fn();
	const getExtension = vi.fn();
	const getValue = vi.fn();
	const updateValue = vi.fn();
	const warn = vi.fn();

	const ctx = createTestContainer()
		.stub(ICommandService, { executeCommand })
		.stub(IExtensionService, { getExtension })
		.stub(IConfigurationService, { getValue, updateValue, onDidChangeConfiguration: onDidChangeConfiguration.event })
		.stub(ILogService, { warn })
		.build();

	beforeEach(() => {
		vi.resetAllMocks();
		getValue.mockReturnValue(['python', 'r']);
		getExtension.mockResolvedValue({ identifier: { value: 'stub' } });
		executeCommand.mockResolvedValue(passing);
	});

	const build = () => ctx.instantiationService.createInstance(EnvironmentHealthTracker, SOURCES);

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

	it('does not start a second run while one is in flight', async () => {
		const tracker = build();
		tracker.refresh('python');
		tracker.refresh('python');
		await settle();
		expect(executeCommand.mock.calls.filter(c => c[0] === 'python.getEnvironmentHealth')).toHaveLength(1);
		tracker.dispose();
	});

	it('keeps the previous result on screen while refreshing', async () => {
		const tracker = build();
		await settle();
		let resolveSecond: (value: unknown) => void = () => { };
		executeCommand.mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
		tracker.refresh('python');
		expect(tracker.state[0].state.kind).toBe('result');
		expect(tracker.isRunning('python')).toBe(true);
		resolveSecond(passing);
		await settle();
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
		const changed = vi.fn();
		const subscription = tracker.onDidChange(changed);
		tracker.dispose();
		subscription.dispose();
		changed.mockClear();
		resolveRun(passing);
		await settle();
		expect(changed).not.toHaveBeenCalled();
	});

	it('returns a fresh array from state so React sees the change', async () => {
		const tracker = build();
		expect(tracker.state).not.toBe(tracker.state);
		tracker.dispose();
	});
});
