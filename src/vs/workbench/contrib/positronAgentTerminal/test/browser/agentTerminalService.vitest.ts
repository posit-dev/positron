/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ICommandDetectionCapability, ITerminalCapabilityImplMap, ITerminalCapabilityStore, ITerminalCommand, TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { IPromptInputModel, PromptInputState } from '../../../../../platform/terminal/common/capabilities/commandDetection/promptInputModel.js';
import { IShellLaunchConfig } from '../../../../../platform/terminal/common/terminal.js';
import { EphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralStateService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ILifecycleService, WillShutdownEvent } from '../../../../services/lifecycle/common/lifecycle.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { PositronAgentTerminalService } from '../../browser/agentTerminalService.js';

const OWNER = 'test.owner';

/** Lets pending promises, such as the saved terminals loading, settle. */
const settle = () => new Promise(resolve => setTimeout(resolve));
const C = '\x1b]633;C\x07';
const D = (code: number) => `\x1b]633;D;${code}\x07`;

describe('PositronAgentTerminalService', () => {
	const disposables = ensureNoLeakedDisposables();

	interface IFakeTerminalOptions {
		/** Answers each command line, as the shell would, after it is sent. */
		respond?: (commandLine: string) => string | undefined;
		/** Written while the command line is being sent, as a prompt still drawing would. */
		beforeSend?: string;
		/** The shell process this terminal reattaches to after a reload. */
		attachTo?: number;
		/** At reattach: whether the shell had child processes, and the last command shell integration restored. */
		restored?: { hasChildProcesses: boolean; lastCommand?: { command: string; exitCode: number } };
		/** Whether the shell has turned on bracketed paste. */
		bracketedPaste?: boolean;
	}

	function fakeTerminal(options: IFakeTerminalOptions = {}) {
		const data = disposables.add(new Emitter<string>());
		const exit = disposables.add(new Emitter<number | undefined>());
		const replayComplete = disposables.add(new Emitter<void>());
		const xterm = { raw: { options: { disableStdin: false }, modes: { bracketedPasteMode: options.bracketedPaste ?? false } } };
		const lastCommand = options.restored?.lastCommand;
		const detection = stubInterface<ICommandDetectionCapability>({
			commands: lastCommand ? [stubInterface<ITerminalCommand>(lastCommand)] : [],
			promptInputModel: stubInterface<IPromptInputModel>({ state: PromptInputState.Input, onDidStartInput: Event.None }),
		});
		const instance = stubInterface<ITerminalInstance>({
			onWillData: data.event,
			onExit: exit.event,
			onDisposed: Event.None,
			onProcessReplayComplete: replayComplete.event,
			processReady: Promise.resolve(),
			shellLaunchConfig: options.attachTo === undefined
				? {}
				: { attachPersistentProcess: stubInterface<NonNullable<IShellLaunchConfig['attachPersistentProcess']>>({ id: options.attachTo, hasChildProcesses: options.restored?.hasChildProcesses }) },
			persistentProcessId: options.attachTo ?? 7,
			shouldPersist: true,
			capabilities: stubInterface<ITerminalCapabilityStore>({
				get: <T extends TerminalCapability>(capability: T) => (capability === TerminalCapability.CommandDetection
					? detection
					: undefined) as ITerminalCapabilityImplMap[T] | undefined,
			}),
			xtermReadyPromise: Promise.resolve(xterm as never),
			runCommand: vi.fn(async (commandLine: string) => {
				if (options.beforeSend !== undefined) {
					data.fire(options.beforeSend);
				}
				const output = options.respond?.(commandLine);
				if (output !== undefined) {
					setTimeout(() => data.fire(output));
				}
			}),
			sendText: vi.fn(async () => { }),
			isDisposed: false,
			dispose: vi.fn(),
		});
		return { instance, data, exit, replayComplete, xterm };
	}

	/** Ephemeral state outlives a window reload, so tests share one across "windows". */
	function createService(terminal: ReturnType<typeof fakeTerminal>, ephemeral = new EphemeralStateService(), shellIntegration = true) {
		const created = disposables.add(new Emitter<ITerminalInstance>());
		const shutdown = disposables.add(new Emitter<WillShutdownEvent>());
		const terminalService = stubInterface<ITerminalService>({
			createTerminal: vi.fn(async () => terminal.instance),
			onDidCreateInstance: created.event,
			instances: [],
		});
		const service = disposables.add(new PositronAgentTerminalService(
			terminalService,
			new TestConfigurationService({ terminal: { integrated: { shellIntegration: { enabled: shellIntegration } } } }),
			ephemeral,
			stubInterface<IWorkspaceContextService>({ getWorkspace: () => stubInterface<IWorkspace>({ id: 'workspace' }) }),
			stubInterface<ILifecycleService>({ onWillShutdown: shutdown.event }),
			new NullLogService(),
		));
		/** Fires the shutdown a reload starts, and waits for the service to save. */
		const reload = async () => {
			const joins: Promise<void>[] = [];
			shutdown.fire(stubInterface<WillShutdownEvent>({
				join: (promise: Promise<void> | (() => Promise<void>)) => {
					joins.push(typeof promise === 'function' ? promise() : promise);
				},
			}));
			await Promise.all(joins);
		};
		return { service, terminalService, ephemeral, created, reload };
	}

	/** Creates the service with one fake terminal. */
	function setup(respond: (commandLine: string) => string | undefined, shellIntegration = true, beforeSend?: string) {
		const terminal = fakeTerminal({ respond, beforeSend });
		const { service, terminalService } = createService(terminal, undefined, shellIntegration);
		return { service, terminalService, ...terminal };
	}

	it('runs a command and reads its output', async () => {
		const { service, xterm } = setup(() => `${C}line 1\r\nline 2\n${D(3)}$ `);
		const terminal = await service.createTerminal(OWNER, { name: 'Agent' });
		expect(xterm.raw.options.disableStdin).toBe(true);

		const command = await service.runCommand(OWNER, terminal.id, 'make', 1000, CancellationToken.None);
		expect(command).toMatchObject({ commandLine: 'make', running: false, exitCode: 3, lineCount: 2 });
		expect(service.readOutput(OWNER, terminal.id, command.id, 0, 100)).toMatchObject({
			offset: 0,
			lines: ['line 1', 'line 2'],
			nextOffset: undefined,
		});
	});

	it('pastes a multi-line command so the shell runs it as one command', async () => {
		const terminal = fakeTerminal({ respond: () => `${C}a\nb\n${D(0)}`, bracketedPaste: true });
		const { service } = createService(terminal);
		const created = await service.createTerminal(OWNER, { name: 'Agent' });

		const command = await service.runCommand(OWNER, created.id, 'echo a\necho b', 1000, CancellationToken.None);
		expect(terminal.instance.runCommand).toHaveBeenCalledWith('echo a\necho b', true, undefined, true);
		expect(command).toMatchObject({ commandLine: 'echo a\necho b', exitCode: 0, lineCount: 2 });
	});

	it('refuses a multi-line command in a shell without bracketed paste', async () => {
		const terminal = fakeTerminal({ respond: () => `${C}${D(0)}` });
		const { service } = createService(terminal);
		const created = await service.createTerminal(OWNER, { name: 'Agent' });

		await expect(service.runCommand(OWNER, created.id, 'echo a\necho b', 1000, CancellationToken.None)).rejects.toThrow(/each line/);
		expect(terminal.instance.runCommand).not.toHaveBeenCalled();
		const command = await service.runCommand(OWNER, created.id, 'echo a \\\necho b', 1000, CancellationToken.None);
		expect(command.exitCode).toBe(0);
	});

	it('ignores the prompt before the command, which ends without a command of its own', async () => {
		const { service } = setup(() => `${C}output\n${D(0)}`, true, `${D(0)}$ `);
		const terminal = await service.createTerminal(OWNER, { name: 'Agent' });

		const command = await service.runCommand(OWNER, terminal.id, 'echo output', 1000, CancellationToken.None);
		expect(command).toMatchObject({ commandLine: 'echo output', exitCode: 0, lineCount: 1 });
		expect(service.getCommands(OWNER, terminal.id)).toHaveLength(1);
	});

	it('returns a long-running command still running, and waits for it again', async () => {
		const { service, data } = setup(() => `${C}serving\n`);
		const terminal = await service.createTerminal(OWNER, { name: 'Agent', allowUserInput: true });

		const command = await service.runCommand(OWNER, terminal.id, 'serve', 0, CancellationToken.None);
		expect(command.running).toBe(true);
		await expect(service.runCommand(OWNER, terminal.id, 'ls', 0, CancellationToken.None)).rejects.toThrow(/already running/);

		const waited = service.waitForCommand(OWNER, terminal.id, command.id, 10_000, CancellationToken.None);
		data.fire(`stopped\n${D(130)}`);
		expect(await waited).toMatchObject({ running: false, exitCode: 130, lineCount: 2 });
	});

	it('pages through output', async () => {
		const { service } = setup(() => `${C}${Array.from({ length: 5 }, (_, i) => `${i}\n`).join('')}${D(0)}`);
		const terminal = await service.createTerminal(OWNER, { name: 'Agent' });
		const command = await service.runCommand(OWNER, terminal.id, 'seq', 1000, CancellationToken.None);
		expect(service.readOutput(OWNER, terminal.id, command.id, 1, 2)).toMatchObject({ offset: 1, lines: ['1', '2'], nextOffset: 3 });
	});

	it('finishes the running command when the shell exits', async () => {
		const { service, exit } = setup(() => C);
		const terminal = await service.createTerminal(OWNER, { name: 'Agent' });
		const command = await service.runCommand(OWNER, terminal.id, 'sleep 100', 0, CancellationToken.None);

		exit.fire(1);
		expect(service.getCommands(OWNER, terminal.id)[0]).toMatchObject({ id: command.id, running: false, exitCode: undefined });
		expect(service.getTerminals(OWNER)[0]).toMatchObject({ exited: true, exitCode: 1 });
		await expect(service.runCommand(OWNER, terminal.id, 'ls', 0, CancellationToken.None)).rejects.toThrow(/exited/);
	});

	it('hides terminals from other owners', async () => {
		const { service } = setup(() => undefined);
		const terminal = await service.createTerminal(OWNER, { name: 'Agent' });
		expect(service.getTerminals('other.owner')).toEqual([]);
		expect(() => service.getCommands('other.owner', terminal.id)).toThrow(/No agent terminal/);
	});

	it('refuses to create a terminal when shell integration is off', async () => {
		const { service, terminalService } = setup(() => undefined, false);
		await expect(service.createTerminal(OWNER, { name: 'Agent' })).rejects.toThrow(/shell integration/);
		expect(terminalService.createTerminal).not.toHaveBeenCalled();
	});

	it('closes the terminal on dispose', async () => {
		const { service, instance } = setup(() => undefined);
		const terminal = await service.createTerminal(OWNER, { name: 'Agent' });
		service.disposeTerminal(OWNER, terminal.id);
		expect(instance.dispose).toHaveBeenCalled();
		expect(service.getTerminals(OWNER)).toEqual([]);
	});

	it('takes back its terminals after a window reload, settling a command that finished meanwhile', async () => {
		const before = fakeTerminal({ respond: line => line === 'ls' ? `${C}a\nb\n${D(0)}` : `${C}serving\n` });
		const first = createService(before);
		const terminal = await first.service.createTerminal(OWNER, { name: 'Agent' });
		const ls = await first.service.runCommand(OWNER, terminal.id, 'ls', 1000, CancellationToken.None);
		const serve = await first.service.runCommand(OWNER, terminal.id, 'serve', 0, CancellationToken.None);
		await first.reload();

		// The shell finished `serve` with code 130 while the window reloaded.
		const after = fakeTerminal({ attachTo: 7, restored: { hasChildProcesses: false, lastCommand: { command: 'serve', exitCode: 130 } } });
		const second = createService(after, first.ephemeral);
		second.created.fire(after.instance);
		after.data.fire('replayed scrollback\n');
		after.replayComplete.fire();
		await settle();

		expect(second.service.getTerminals(OWNER)).toEqual([expect.objectContaining({ id: terminal.id, name: 'Agent', exited: false })]);
		expect(second.service.getCommands(OWNER, terminal.id)).toMatchObject([
			{ id: ls.id, running: false, exitCode: 0, lineCount: 2, missingOutput: false },
			{ id: serve.id, running: false, exitCode: 130, lineCount: 1, missingOutput: true },
		]);
		expect(second.service.readOutput(OWNER, terminal.id, ls.id, 0, 10).lines).toEqual(['a', 'b']);
		expect(after.xterm.raw.options.disableStdin).toBe(true);
	});

	it('keeps following a command that runs through a window reload', async () => {
		const before = fakeTerminal({ respond: () => `${C}one\n` });
		const first = createService(before);
		const terminal = await first.service.createTerminal(OWNER, { name: 'Agent', allowUserInput: true });
		const serve = await first.service.runCommand(OWNER, terminal.id, 'serve', 0, CancellationToken.None);
		await first.reload();

		const after = fakeTerminal({ attachTo: 7, restored: { hasChildProcesses: true } });
		const second = createService(after, first.ephemeral);
		second.created.fire(after.instance);
		after.replayComplete.fire();
		await settle();
		after.data.fire(`two\n${D(0)}`);

		expect(second.service.getCommands(OWNER, terminal.id)[0]).toMatchObject({ id: serve.id, running: false, exitCode: 0, missingOutput: true });
		expect(second.service.readOutput(OWNER, terminal.id, serve.id, 0, 10).lines).toEqual(['one', 'two']);
		expect(after.xterm.raw.options.disableStdin).toBe(false);
	});

	it('leaves alone terminals it did not save', async () => {
		const other = fakeTerminal({ attachTo: 99 });
		const { service, created } = createService(other);
		created.fire(other.instance);
		other.replayComplete.fire();
		await settle();

		expect(service.getTerminals(OWNER)).toEqual([]);
	});
});
