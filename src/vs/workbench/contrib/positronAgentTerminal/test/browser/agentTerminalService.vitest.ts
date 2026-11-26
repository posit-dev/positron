/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-amd-node-module -- test needs the real module; the AMD loader is unavailable in vitest
import { SerializeAddon } from '@xterm/addon-serialize';
// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module -- test needs a real xterm buffer, which the headless xterm the pty host uses provides without a DOM
import pkg from '@xterm/headless';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { IShellLaunchConfig } from '../../../../../platform/terminal/common/terminal.js';
import { ShellIntegrationAddon } from '../../../../../platform/terminal/common/xterm/shellIntegrationAddon.js';
import { EphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralStateService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ILifecycleService, WillShutdownEvent } from '../../../../services/lifecycle/common/lifecycle.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { XtermTerminal } from '../../../terminal/browser/xterm/xtermTerminal.js';
import { PositronAgentTerminalService } from '../../browser/agentTerminalService.js';

const { Terminal } = pkg;

const OWNER = 'test.owner';

/** Lets pending promises, such as the saved terminals loading, settle. */
const settle = () => new Promise(resolve => setTimeout(resolve));
const PROMPT = '\x1b]633;A\x07$ \x1b]633;B\x07';
const C = '\x1b]633;C\x07';
const D = (code: number) => `\x1b]633;D;${code}\x07`;
const NONCE = 'nonce';
/** Reports a command line; the nonce marks it as from the shell integration script. */
const E = (commandLine: string) => `\x1b]633;E;${commandLine};${NONCE}\x07`;

/** What a shell writes for a command that prints `output` and exits with `code`. */
const finishes = (output: string, code = 0) => `${C}${output}${D(code)}${PROMPT}`;

describe('PositronAgentTerminalService', () => {
	const disposables = ensureNoLeakedDisposables();

	interface IFakeTerminalOptions {
		/** What the shell writes after echoing each command line. */
		respond?: (commandLine: string) => string;
		/** The shell process this terminal reattaches to after a reload. */
		attachTo?: number;
		/** At reattach: whether the shell had child processes. */
		hasChildProcesses?: boolean;
		/** Whether the shell has turned on bracketed paste. */
		bracketedPaste?: boolean;
		scrollback?: number;
	}

	/** A terminal whose buffer and shell integration are a real headless xterm's. */
	async function fakeTerminal(options: IFakeTerminalOptions = {}) {
		const xterm = new Terminal({ allowProposedApi: true, cols: 80, rows: 10, scrollback: options.scrollback ?? 1000 });
		const shellIntegration = new ShellIntegrationAddon(NONCE, true, undefined, undefined, new NullLogService());
		xterm.loadAddon(shellIntegration);
		disposables.add({ dispose: () => xterm.dispose() });
		const write = (data: string) => new Promise<void>(resolve => xterm.write(data, resolve));
		const exit = disposables.add(new Emitter<number | undefined>());
		const replayComplete = disposables.add(new Emitter<void>());
		/** What the shell has written, in order; each write can arrive late, as over a slow connection. */
		let shell = Promise.resolve();
		const answer = (data: string, delayMs = 0) => {
			shell = shell.then(() => timeout(delayMs)).then(() => write(data));
		};
		// The headless xterm has the same buffer API as the browser one the instance wraps.
		const xtermTerminal = stubInterface<XtermTerminal>({ raw: xterm as never });
		const instance = stubInterface<ITerminalInstance>({
			onExit: exit.event,
			onDisposed: Event.None,
			onProcessReplayComplete: replayComplete.event,
			processReady: Promise.resolve(),
			shellLaunchConfig: options.attachTo === undefined
				? {}
				: { attachPersistentProcess: stubInterface<NonNullable<IShellLaunchConfig['attachPersistentProcess']>>({ id: options.attachTo, hasChildProcesses: options.hasChildProcesses }) },
			persistentProcessId: options.attachTo ?? 7,
			shouldPersist: true,
			capabilities: shellIntegration.capabilities,
			xterm: xtermTerminal,
			xtermReadyPromise: Promise.resolve(xtermTerminal),
			runCommand: vi.fn(async (commandLine: string) => {
				// Like upstream, clear text at the prompt and wait a little.
				if (shellIntegration.capabilities.get(TerminalCapability.CommandDetection)?.promptInputModel.value) {
					await instance.sendText('\x03', false);
					await timeout(100);
				}
				answer(`${commandLine}\r\n${E(commandLine)}${options.respond?.(commandLine) ?? ''}`);
			}),
			sendText: vi.fn(async (text: string) => {
				if (text === '\x03') {
					// A new prompt, arriving later than upstream's runCommand waits after its Ctrl+C.
					answer(`^C\r\n${D(130)}${PROMPT}`, 150);
				}
			}),
			isDisposed: false,
			dispose: vi.fn(),
		});
		if (options.attachTo === undefined) {
			await write(`${options.bracketedPaste ? '\x1b[?2004h' : ''}${PROMPT}`);
		}
		/** Waits for what the shell wrote to reach the buffer. */
		const flush = async () => {
			await shell;
			await settle();
		};
		return { instance, xterm, shellIntegration, write, flush, exit, replayComplete };
	}

	/** Ephemeral state outlives a window reload, so tests share one across "windows". */
	function createService(terminal: Awaited<ReturnType<typeof fakeTerminal>>, ephemeral = new EphemeralStateService(), shellIntegration = true, whenConnected = Promise.resolve()) {
		const created = disposables.add(new Emitter<ITerminalInstance>());
		const shutdown = disposables.add(new Emitter<WillShutdownEvent>());
		const terminalService = stubInterface<ITerminalService>({
			createTerminal: vi.fn(async () => terminal.instance),
			onDidCreateInstance: created.event,
			instances: [],
			whenConnected,
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
	async function setup(respond: (commandLine: string) => string, options: IFakeTerminalOptions = {}) {
		const terminal = await fakeTerminal({ respond, ...options });
		const { service, terminalService } = createService(terminal);
		const created = await service.createTerminal(OWNER, { name: 'Agent' });
		return { service, terminalService, terminal, id: created.id };
	}

	/**
	 * Reattaches to the shell of `before` in a new window, as the pty host
	 * does: replays its buffer, then restores its shell integration state.
	 */
	async function reattach(before: Awaited<ReturnType<typeof fakeTerminal>>, ephemeral: EphemeralStateService, hasChildProcesses: boolean) {
		const serializer = new SerializeAddon();
		before.xterm.loadAddon(serializer);
		const replay = serializer.serialize();
		const commands = before.shellIntegration.serialize();
		const after = await fakeTerminal({ attachTo: 7, hasChildProcesses });
		const second = createService(after, ephemeral);
		second.created.fire(after.instance);
		await after.write(replay);
		after.shellIntegration.deserialize(commands);
		after.replayComplete.fire();
		await settle();
		return { ...second, after };
	}

	it('gives the shell the agent environment, which the caller can override', async () => {
		const terminal = await fakeTerminal();
		const { service, terminalService } = createService(terminal);
		await service.createTerminal(OWNER, { name: 'Agent', env: { GIT_PAGER: 'less', DEBIAN_FRONTEND: null, FOO: 'bar' } });

		expect(vi.mocked(terminalService.createTerminal).mock.calls[0][0]?.config).toMatchObject({
			env: {
				AI_AGENT: 'test_owner',
				GIT_PAGER: 'less',
				GIT_EDITOR: ':',
				GIT_MERGE_AUTOEDIT: 'no',
				DEBIAN_FRONTEND: null,
				VSCODE_AGENT_ZSH_FIXUPS: '1',
				FOO: 'bar',
			},
		});
	});

	it('runs a command and reads its output', async () => {
		const { service, terminal, id } = await setup(() => finishes('line 1\r\nline 2\r\n', 3));

		const command = await service.runCommand(OWNER, id, 'make', 1000, CancellationToken.None);
		await terminal.flush();
		expect(service.readOutput(OWNER, id, command.id, 0, 100)).toMatchObject({
			command: { commandLine: 'make', running: false, exitCode: 3, lineCount: 2, outputTrimmed: false },
			offset: 0,
			lines: ['line 1', 'line 2'],
			nextOffset: undefined,
		});
	});

	it('reads output as the terminal shows it, with progress redrawn in place', async () => {
		const spinner = ['\x1b[2K\x1b[1G| working', '\x1b[2K\x1b[1G/ working', '\x1b[2K\x1b[1Gdone'].join('');
		const { service, terminal, id } = await setup(() => finishes(`${spinner}\r\n50%\r100%\r\n`));

		const command = await service.runCommand(OWNER, id, 'npm install', 1000, CancellationToken.None);
		await terminal.flush();
		expect(service.readOutput(OWNER, id, command.id, 0, 100).lines).toEqual(['done', '100%']);
	});

	it('joins wrapped lines and cuts long ones', async () => {
		const { service, terminal, id } = await setup(() => finishes(`${'a'.repeat(200)}\r\n${'b'.repeat(1_100)}\r\n`));

		const command = await service.runCommand(OWNER, id, 'cat long', 1000, CancellationToken.None);
		await terminal.flush();
		const lines = service.readOutput(OWNER, id, command.id, 0, 100).lines;
		expect(lines[0]).toBe('a'.repeat(200));
		expect(lines[1]).toBe(`${'b'.repeat(1_000)} [truncated]`);
	});

	it('clears text left at the prompt before running, and tracks the command it ran', async () => {
		const { service, terminal, id } = await setup(() => finishes('built\r\n'));
		await terminal.write('half-typed');

		const command = await service.runCommand(OWNER, id, 'make', 1000, CancellationToken.None);
		expect(terminal.instance.sendText).toHaveBeenCalledWith('\x03', false);
		expect(command).toMatchObject({ commandLine: 'make', running: false, exitCode: 0 });
		await terminal.flush();
		expect(service.readOutput(OWNER, id, command.id, 0, 10).lines).toEqual(['built']);
	});

	it('pastes a multi-line command so the shell runs it as one command', async () => {
		const { service, terminal, id } = await setup(() => finishes('a\r\nb\r\n'), { bracketedPaste: true });

		const command = await service.runCommand(OWNER, id, 'echo a\necho b', 1000, CancellationToken.None);
		expect(terminal.instance.runCommand).toHaveBeenCalledWith('echo a\necho b', true, undefined, true);
		expect(command).toMatchObject({ commandLine: 'echo a\necho b', exitCode: 0 });
	});

	it('refuses a multi-line command in a shell without bracketed paste', async () => {
		const { service, terminal, id } = await setup(() => finishes(''));

		await expect(service.runCommand(OWNER, id, 'echo a\necho b', 1000, CancellationToken.None)).rejects.toThrow(/each line/);
		expect(terminal.instance.runCommand).not.toHaveBeenCalled();
		const command = await service.runCommand(OWNER, id, 'echo a \\\necho b', 1000, CancellationToken.None);
		expect(command.exitCode).toBe(0);
		// A trailing line break doesn't make a command multi-line.
		expect(await service.runCommand(OWNER, id, 'ls\n', 1000, CancellationToken.None)).toMatchObject({ commandLine: 'ls', exitCode: 0 });
	});

	it('returns a long-running command still running, and waits for it again', async () => {
		const { service, terminal, id } = await setup(() => `${C}serving\r\n`);

		const command = await service.runCommand(OWNER, id, 'serve', 0, CancellationToken.None);
		expect(command.running).toBe(true);
		await expect(service.runCommand(OWNER, id, 'ls', 0, CancellationToken.None)).rejects.toThrow(/already running/);

		await terminal.flush();
		const waited = service.waitForCommand(OWNER, id, command.id, 10_000, CancellationToken.None);
		await terminal.write(`stopped\r\n${D(130)}${PROMPT}`);
		expect(await waited).toMatchObject({ running: false, exitCode: 130, lineCount: 2 });
	});

	it('pages through output', async () => {
		const { service, terminal, id } = await setup(() => finishes(Array.from({ length: 5 }, (_, i) => `${i}\r\n`).join('')));

		const command = await service.runCommand(OWNER, id, 'seq', 1000, CancellationToken.None);
		await terminal.flush();
		expect(service.readOutput(OWNER, id, command.id, 1, 2)).toMatchObject({ offset: 1, lines: ['1', '2'], nextOffset: 3 });
	});

	it('marks output whose start scrolled out of the scrollback', async () => {
		const { service, terminal, id } = await setup(() => finishes(Array.from({ length: 30 }, (_, i) => `${i}\r\n`).join('')), { scrollback: 5 });

		const command = await service.runCommand(OWNER, id, 'seq', 1000, CancellationToken.None);
		await terminal.flush();
		const output = service.readOutput(OWNER, id, command.id, 0, 100);
		expect(output.command.outputTrimmed).toBe(true);
		expect(output.lines.at(-1)).toBe('29');
	});

	it('finishes the running command when the shell exits', async () => {
		const { service, terminal, id } = await setup(() => C);
		const command = await service.runCommand(OWNER, id, 'sleep 100', 0, CancellationToken.None);

		terminal.exit.fire(1);
		expect(service.getStatus(OWNER, id)).toMatchObject({ exited: true, exitCode: 1, commands: [{ id: command.id, running: false, exitCode: undefined }] });
		await expect(service.runCommand(OWNER, id, 'ls', 0, CancellationToken.None)).rejects.toThrow(/exited/);
	});

	it('stops waiting on a running command when the terminal is disposed', async () => {
		const { service, id } = await setup(() => C);
		const command = await service.runCommand(OWNER, id, 'sleep 100', 0, CancellationToken.None);

		const waited = service.waitForCommand(OWNER, id, command.id, 60_000, CancellationToken.None);
		service.disposeTerminal(OWNER, id);
		expect(await waited).toMatchObject({ running: false, exitCode: undefined });
	});

	it('fails a run, without sending it, when the shell exits while it starts', async () => {
		const { service, terminal, id } = await setup(() => finishes(''));
		// The run waits for the shell to clear this text before sending.
		await terminal.write('half-typed');

		const run = service.runCommand(OWNER, id, 'make', 1000, CancellationToken.None);
		terminal.exit.fire(1);
		await expect(run).rejects.toThrow(/exited/);
		expect(terminal.instance.runCommand).not.toHaveBeenCalled();
	});

	it('hides terminals from other owners', async () => {
		const { service, id } = await setup(() => '');
		expect(await service.getTerminals('other.owner')).toEqual([]);
		expect(() => service.getStatus('other.owner', id)).toThrow(/No agent terminal/);
	});

	it('refuses to create a terminal when shell integration is off', async () => {
		const terminal = await fakeTerminal();
		const { service, terminalService } = createService(terminal, undefined, false);
		await expect(service.createTerminal(OWNER, { name: 'Agent' })).rejects.toThrow(/shell integration/);
		expect(terminalService.createTerminal).not.toHaveBeenCalled();
	});

	it('closes the terminal on dispose', async () => {
		const { service, terminal, id } = await setup(() => '');
		service.disposeTerminal(OWNER, id);
		expect(terminal.instance.dispose).toHaveBeenCalled();
		expect(await service.getTerminals(OWNER)).toEqual([]);
	});

	it('takes back its terminals after a window reload, settling a command that finished meanwhile', async () => {
		const before = await fakeTerminal({ respond: line => line === 'ls' ? finishes('a\r\nb\r\n') : `${C}serving\r\n` });
		const first = createService(before);
		const terminal = await first.service.createTerminal(OWNER, { name: 'Agent' });
		const ls = await first.service.runCommand(OWNER, terminal.id, 'ls', 1000, CancellationToken.None);
		const serve = await first.service.runCommand(OWNER, terminal.id, 'serve', 0, CancellationToken.None);
		await before.flush();
		await first.reload();

		// The shell finished `serve` with code 130 while the window reloaded.
		await before.write(`stopped\r\n${D(130)}${PROMPT}`);
		const second = await reattach(before, first.ephemeral, false);

		expect(await second.service.getTerminals(OWNER)).toEqual([expect.objectContaining({ id: terminal.id, name: 'Agent', exited: false })]);
		expect(second.service.getStatus(OWNER, terminal.id).commands).toMatchObject([
			{ id: ls.id, running: false, exitCode: 0, lineCount: 2 },
			{ id: serve.id, running: false, exitCode: 130, lineCount: 2 },
		]);
		expect(second.service.readOutput(OWNER, terminal.id, ls.id, 0, 10).lines).toEqual(['a', 'b']);
		expect(second.service.readOutput(OWNER, terminal.id, serve.id, 0, 10).lines).toEqual(['serving', 'stopped']);
	});

	it('keeps following a command that runs through a window reload', async () => {
		const before = await fakeTerminal({ respond: () => `${C}one\r\n` });
		const first = createService(before);
		const terminal = await first.service.createTerminal(OWNER, { name: 'Agent' });
		const serve = await first.service.runCommand(OWNER, terminal.id, 'serve', 0, CancellationToken.None);
		await before.flush();
		await first.reload();

		const second = await reattach(before, first.ephemeral, true);
		expect(second.service.getStatus(OWNER, terminal.id).commands[0]).toMatchObject({ id: serve.id, running: true });
		await second.after.write(`two\r\n${D(0)}${PROMPT}`);

		expect(second.service.getStatus(OWNER, terminal.id).commands[0]).toMatchObject({ id: serve.id, running: false, exitCode: 0 });
		expect(second.service.readOutput(OWNER, terminal.id, serve.id, 0, 10).lines).toEqual(['$ serve', 'one', 'two']);
	});

	it('waits for terminals that outlived a window reload before listing them', async () => {
		const before = await fakeTerminal();
		const first = createService(before);
		const terminal = await first.service.createTerminal(OWNER, { name: 'Agent' });
		await first.reload();

		const connected = new DeferredPromise<void>();
		const after = await fakeTerminal({ attachTo: 7, hasChildProcesses: false });
		const second = createService(after, first.ephemeral, true, connected.p);
		// Asked before the terminal service reattaches the shell.
		const listed = second.service.getTerminals(OWNER);
		second.created.fire(after.instance);
		after.replayComplete.fire();
		connected.complete();

		expect(await listed).toEqual([expect.objectContaining({ id: terminal.id })]);
	});

	it('leaves alone terminals it did not save', async () => {
		const other = await fakeTerminal({ attachTo: 99 });
		const { service, created } = createService(other);
		created.fire(other.instance);
		other.replayComplete.fire();
		await settle();

		expect(await service.getTerminals(OWNER)).toEqual([]);
	});
});
