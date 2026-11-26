/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IMarker } from '@xterm/xterm';
import { DeferredPromise, raceCancellation, raceTimeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { AiAgentEnvVar } from '../../../../platform/chat/common/aiAgentEnv.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { ICommandDetectionCapability, ITerminalCommand, TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { PromptInputState } from '../../../../platform/terminal/common/capabilities/commandDetection/promptInputModel.js';
import { TerminalSettingId } from '../../../../platform/terminal/common/terminal.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { getShellIntegrationTimeout } from '../../terminal/common/terminalEnvironment.js';
import { ICommandOutput, readCommandOutput, truncateLine } from './agentTerminalOutput.js';
import { IAgentTerminal, IAgentTerminalCommand, IAgentTerminalCreateOptions, IAgentTerminalOutput, IAgentTerminalStatus, IPositronAgentTerminalService, MAX_READ_LINES } from '../common/agentTerminalService.js';

/** How many commands a terminal remembers, dropping the oldest. */
const MAX_COMMANDS = 50;

/** How long to wait for the shell to report that a command it was sent started. */
const COMMAND_START_TIMEOUT_MS = 10_000;

/**
 * Environment for commands run on an agent's behalf, as upstream's agent
 * terminals set it: tools that would wait for input, or page or edit
 * interactively, act without it. Set in the terminal's own environment, so
 * it isn't an extension's contribution.
 */
function agentEnvironment(ownerId: string): Record<string, string> {
	return {
		// Lets tools such as `gh` see which agent runs them; values are limited to these characters.
		[AiAgentEnvVar]: ownerId.replace(/[^a-zA-Z0-9_-]/g, '_'),
		GIT_PAGER: 'cat',
		GIT_MERGE_AUTOEDIT: 'no',
		// `:` is a no-op in `sh`, which git runs its editor with.
		GIT_EDITOR: ':',
		DEBIAN_FRONTEND: 'noninteractive',
		// zsh shell integration then turns off `!` history expansion, which can
		// leave a quoted `!` waiting at a `dquote>` prompt. Other shells ignore it.
		VSCODE_AGENT_ZSH_FIXUPS: '1',
	};
}

function exitedError(): Error {
	return new Error(localize('positron.agentTerminal.exited', "The terminal has exited."));
}

/** Prefix of the ephemeral state key, per workspace, that holds agent terminals across a window reload. */
const SAVED_TERMINALS_KEY = 'positron.agentTerminals';

interface ISavedAgentCommand {
	readonly id: string;
	readonly commandLine: string;
	readonly startTime: number;
	readonly endTime?: number;
	readonly exitCode?: number;
}

interface ISavedAgentTerminal {
	readonly id: string;
	readonly ownerId: string;
	readonly name: string;
	readonly nextCommandId: number;
	readonly commands: ISavedAgentCommand[];
}

/** Saved agent terminals, keyed by their shell's persistent process ID. */
type SavedAgentTerminals = Record<number, ISavedAgentTerminal>;

class AgentCommand {
	readonly startTime: number;
	endTime: number | undefined;
	exitCode: number | undefined;
	/** Where its output starts in the terminal's buffer. */
	start: IMarker | undefined;
	/** Where its output ends, once it finished. */
	end: IMarker | undefined;
	private readonly _finished = new DeferredPromise<void>();

	constructor(readonly id: string, readonly commandLine: string, start: IMarker | undefined, saved?: ISavedAgentCommand) {
		this.start = start;
		this.startTime = saved?.startTime ?? Date.now();
		this.endTime = saved?.endTime;
		this.exitCode = saved?.exitCode;
		if (!this.running) {
			this._finished.complete();
		}
	}

	get running(): boolean {
		return this.endTime === undefined;
	}

	get finished(): Promise<void> {
		return this._finished.p;
	}

	finish(exitCode: number | undefined, end: IMarker | undefined): void {
		if (this.running) {
			this.exitCode = exitCode;
			this.end = end;
			this.endTime = Date.now();
			this._finished.complete();
		}
	}

	/** Takes its output's place in the buffer from the command shell integration restored. */
	link(restored: ITerminalCommand): void {
		this.start = restored.executedMarker;
		this.end = restored.endMarker;
	}

	toDto(output: ICommandOutput): IAgentTerminalCommand {
		return {
			id: this.id,
			commandLine: this.commandLine,
			running: this.running,
			exitCode: this.exitCode,
			startTime: this.startTime,
			endTime: this.endTime,
			lineCount: output.lines.length,
			outputTrimmed: output.trimmed,
		};
	}

	serialize(): ISavedAgentCommand {
		return {
			id: this.id,
			commandLine: this.commandLine,
			startTime: this.startTime,
			endTime: this.endTime,
			exitCode: this.exitCode,
		};
	}
}

/** Restores an agent terminal whose shell outlived a window reload. */
interface IAdoption {
	readonly saved: ISavedAgentTerminal;
	/** Whether the terminal finished replaying its buffer and restoring its commands. */
	readonly replayed: boolean;
}

/** Tracks one agent terminal's commands with its shell integration. */
class AgentTerminal extends Disposable implements IAgentTerminal {
	readonly id: string;
	exited = false;
	exitCode: number | undefined;

	private _detection: ICommandDetectionCapability | undefined;
	private readonly _commands: AgentCommand[] = [];
	private _nextCommandId = 1;
	private _current: AgentCommand | undefined;
	/**
	 * A command line being run that hasn't started yet. Until it is `sent`,
	 * commands that start belong to someone else, such as the user. `started`
	 * resolves with no command if the terminal exits first.
	 */
	private _pending: { commandLine: string; sent: boolean; started: DeferredPromise<AgentCommand | undefined> } | undefined;
	/** Commands restored during a reload's replay aren't new, so they're ignored until it completes. */
	private _replaying: boolean;
	/**
	 * Whether `_current` was running when the window reloaded. Shell
	 * integration lost its start, so the shell reporting it finished also
	 * reports it starting.
	 */
	private _resumed = false;

	constructor(
		readonly ownerId: string,
		readonly name: string,
		readonly instance: ITerminalInstance,
		adoption?: IAdoption,
	) {
		super();
		this.id = adoption?.saved.id ?? generateUuid();
		this._replaying = adoption !== undefined && !adoption.replayed;
		if (adoption) {
			this._nextCommandId = adoption.saved.nextCommandId;
			for (const saved of adoption.saved.commands) {
				const command = new AgentCommand(saved.id, saved.commandLine, undefined, saved);
				this._commands.push(command);
				if (command.running) {
					this._current = command;
				}
			}
		}
		const detection = instance.capabilities.get(TerminalCapability.CommandDetection);
		if (detection) {
			this._attach(detection);
		} else {
			this._register(Event.once(instance.capabilities.onDidAddCommandDetectionCapability)(d => this._attach(d)));
		}
		this._register(instance.onExit(e => this._onExit(typeof e === 'number' ? e : undefined)));
		this._register(instance.onDisposed(() => this._onExit(undefined)));
		if (this._replaying) {
			this._register(Event.once(instance.onProcessReplayComplete)(() => {
				this._replaying = false;
				this._link();
			}));
		} else if (adoption) {
			this._link();
		}
	}

	private _attach(detection: ICommandDetectionCapability): void {
		this._detection = detection;
		this._register(detection.onCommandExecuted(() => this._onExecuted(detection)));
		this._register(detection.onCommandFinished(command => this._onFinished(command)));
	}

	/**
	 * After a reload, finds the saved commands' output in the replayed buffer
	 * by matching them, newest first, to the commands shell integration
	 * restored. If the shell had no child processes when it reattached, the
	 * command that was running finished meanwhile, and is the last one restored
	 * when its command line matches. Otherwise it is still running, or a
	 * background helper the shell keeps makes it look so; interrupting it
	 * settles it either way. Its output then starts at its prompt.
	 */
	private _link(): void {
		const restored = this._detection?.commands ?? [];
		let next = restored.length;
		const current = this._current;
		if (current) {
			if (this.instance.shellLaunchConfig.attachPersistentProcess?.hasChildProcesses === false) {
				const last = restored.at(-1);
				if (last && last.command.trim() === current.commandLine.trim()) {
					current.link(last);
					current.finish(last.exitCode, last.endMarker);
					next--;
				} else {
					current.finish(undefined, undefined);
				}
				this._current = undefined;
			} else {
				current.start = this._detection?.currentCommand?.commandStartMarker;
				this._resumed = true;
			}
		}
		for (let i = this._commands.length - 1; i >= 0; i--) {
			const command = this._commands[i];
			if (command === current) {
				continue;
			}
			for (let j = next - 1; j >= 0; j--) {
				if (restored[j].command.trim() === command.commandLine.trim()) {
					command.link(restored[j]);
					next = j;
					break;
				}
			}
		}
	}

	get commands(): readonly AgentCommand[] {
		return this._commands;
	}

	getCommand(commandId: string): AgentCommand {
		const command = this._commands.find(c => c.id === commandId);
		if (!command) {
			throw new Error(localize('positron.agentTerminal.noCommand', "No command with ID {0} in terminal {1}.", commandId, this.id));
		}
		return command;
	}

	/** A command's output, read from the terminal's buffer. */
	readOutput(command: AgentCommand): ICommandOutput {
		const buffer = this.instance.xterm?.raw.buffer.normal;
		return buffer ? readCommandOutput(buffer, command.start, command.end) : { lines: [], trimmed: false };
	}

	commandDto(command: AgentCommand): IAgentTerminalCommand {
		return command.toDto(this.readOutput(command));
	}

	async run(commandLine: string): Promise<AgentCommand> {
		if (this.exited) {
			throw exitedError();
		}
		if (this._current || this._pending) {
			throw new Error(localize('positron.agentTerminal.busy', "A command is already running in this terminal. Wait for it to finish or interrupt it."));
		}
		// The shell's Enter ends the command, so trailing line breaks would only make it multi-line.
		commandLine = commandLine.replace(/[\r\n]+$/, '');
		this._pending = { commandLine, sent: false, started: new DeferredPromise<AgentCommand | undefined>() };
		const pending = this._pending;
		try {
			await this._clearPrompt();
			// Lines sent one by one run as separate commands; a paste runs as one.
			const multiline = /(?<!\\)\n/.test(commandLine.replace(/\r\n?/g, '\n'));
			if (multiline && !await this._acceptsPaste()) {
				throw new Error(localize('positron.agentTerminal.noPaste', "This shell would run each line of the command separately. Join the lines with `;` or `&&`, or put them in a script."));
			}
			if (this.exited) {
				throw exitedError();
			}
			await this.instance.runCommand(commandLine, true, undefined, multiline);
			pending.sent = true;
			const command = await raceTimeout(pending.started.p, COMMAND_START_TIMEOUT_MS);
			if (!command) {
				throw this.exited ? exitedError() : new Error(localize('positron.agentTerminal.noStart', "The shell didn't report the command starting."));
			}
			return command;
		} finally {
			if (this._pending === pending) {
				this._pending = undefined;
			}
		}
	}

	/**
	 * Waits for the prompt, and clears text left at it with Ctrl+C. The shell's
	 * new prompt then arrives before the command is sent, so its end isn't taken
	 * for the command's.
	 */
	private async _clearPrompt(): Promise<void> {
		const prompt = this._detection?.promptInputModel;
		if (!prompt) {
			return;
		}
		const store = new DisposableStore();
		try {
			if (prompt.state !== PromptInputState.Input) {
				await raceTimeout(Event.toPromise(prompt.onDidStartInput, store), COMMAND_START_TIMEOUT_MS);
			}
			if (prompt.value) {
				const restarted = Event.toPromise(prompt.onDidStartInput, store);
				await this.instance.sendText('\x03', false);
				await raceTimeout(restarted, COMMAND_START_TIMEOUT_MS);
			}
		} finally {
			store.dispose();
		}
	}

	/** Whether the shell takes bracketed paste, which it turns on before each prompt. */
	private async _acceptsPaste(): Promise<boolean> {
		const xterm = await this.instance.xtermReadyPromise;
		return xterm?.raw.modes.bracketedPasteMode === true;
	}

	/** A command started, or ended without starting, such as an empty line. */
	private _onExecuted(detection: ICommandDetectionCapability): void {
		if (this._replaying || this._resumed) {
			return;
		}
		this._current?.finish(undefined, undefined);
		const executed = detection.currentCommand;
		const pending = this._pending?.sent ? this._pending : undefined;
		const command = new AgentCommand(String(this._nextCommandId++), pending?.commandLine ?? executed?.command ?? '', executed?.commandExecutedMarker);
		this._commands.push(command);
		const finished = this._commands.filter(c => !c.running);
		if (this._commands.length > MAX_COMMANDS && finished.length) {
			this._commands.splice(this._commands.indexOf(finished[0]), 1);
		}
		if (pending) {
			pending.started.complete(command);
			this._pending = undefined;
		}
		this._current = command;
	}

	private _onFinished(command: ITerminalCommand): void {
		if (this._replaying) {
			return;
		}
		this._resumed = false;
		this._current?.finish(command.exitCode, command.endMarker);
		this._current = undefined;
	}

	private _onExit(exitCode: number | undefined): void {
		if (this.exited) {
			return;
		}
		this.exited = true;
		this.exitCode = exitCode;
		this._current?.finish(undefined, undefined);
		this._current = undefined;
		this._pending?.started.complete(undefined);
		this._pending = undefined;
	}

	/** Settles its commands and runs, as the terminal won't report them anymore. */
	override dispose(): void {
		this._onExit(undefined);
		super.dispose();
	}

	toDto(): IAgentTerminal {
		return { id: this.id, ownerId: this.ownerId, name: this.name, exited: this.exited, exitCode: this.exitCode };
	}

	serialize(): ISavedAgentTerminal {
		return {
			id: this.id,
			ownerId: this.ownerId,
			name: this.name,
			nextCommandId: this._nextCommandId,
			commands: this._commands.map(c => c.serialize()),
		};
	}
}

export class PositronAgentTerminalService extends Disposable implements IPositronAgentTerminalService {
	declare readonly _serviceBrand: undefined;

	private readonly _terminals = new Map<string, AgentTerminal>();
	/** Agent terminals saved before the window reloaded. */
	private readonly _saved: Promise<SavedAgentTerminals | undefined>;

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._saved = this._ephemeralStateService.getItem<SavedAgentTerminals>(this._savedKey).catch(err => {
			this._logService.warn(`Can't read saved agent terminals: ${err}`);
			return undefined;
		});
		this._register(this._terminalService.onDidCreateInstance(instance => this._adopt(instance, false)));
		for (const instance of this._terminalService.instances) {
			// Created before this service, so its replay has likely finished.
			this._adopt(instance, true);
		}
		this._register(lifecycleService.onWillShutdown(e => e.join(this._save(), {
			id: 'positronAgentTerminals',
			label: localize('positron.agentTerminal.saving', "Saving agent terminals"),
		})));
	}

	/** Ephemeral state is shared by workspaces, such as on Positron Server. */
	private get _savedKey(): string {
		return `${SAVED_TERMINALS_KEY}.${this._workspaceContextService.getWorkspace().id}`;
	}

	/** Takes back an agent terminal whose shell was reattached after a window reload. */
	private _adopt(instance: ITerminalInstance, replayed: boolean): void {
		const processId = instance.shellLaunchConfig.attachPersistentProcess?.id;
		if (processId === undefined) {
			return;
		}
		// The replay may complete while the saved terminals load.
		const replayListener = instance.onProcessReplayComplete(() => replayed = true);
		void this._saved.then(saved => {
			replayListener.dispose();
			const record = saved?.[processId];
			if (!record || instance.isDisposed || this._terminals.has(record.id)) {
				return;
			}
			const terminal = new AgentTerminal(record.ownerId, record.name, instance, { saved: record, replayed });
			this._terminals.set(terminal.id, terminal);
		});
	}

	/** Saves the terminals whose shells can outlive a window reload. */
	private async _save(): Promise<void> {
		const saved: SavedAgentTerminals = {};
		for (const terminal of this._terminals.values()) {
			const processId = terminal.instance.persistentProcessId;
			if (!terminal.exited && processId !== undefined && terminal.instance.shouldPersist) {
				saved[processId] = terminal.serialize();
			}
		}
		await this._ephemeralStateService.setItem(this._savedKey, saved);
	}

	async createTerminal(ownerId: string, options: IAgentTerminalCreateOptions): Promise<IAgentTerminal> {
		const shellIntegrationEnabled = this._configurationService.getValue(TerminalSettingId.ShellIntegrationEnabled) === true;
		if (!shellIntegrationEnabled) {
			throw new Error(localize('positron.agentTerminal.siDisabled', "Agent terminals need shell integration, which the {0} setting turns off.", `\`${TerminalSettingId.ShellIntegrationEnabled}\``));
		}

		const instance = await this._terminalService.createTerminal({
			config: {
				name: options.name,
				icon: ThemeIcon.fromId(Codicon.sparkle.id),
				cwd: options.cwd,
				env: { ...agentEnvironment(ownerId), ...options.env },
				strictEnv: options.strictEnv,
				executable: options.shellPath,
				args: options.shellArgs,
			}
		});
		const terminal = new AgentTerminal(ownerId, options.name, instance);
		try {
			await this._waitForShellIntegration(instance);
		} catch (e) {
			terminal.dispose();
			instance.dispose();
			throw e;
		}

		this._terminals.set(terminal.id, terminal);
		return terminal.toDto();
	}

	private async _waitForShellIntegration(instance: ITerminalInstance): Promise<void> {
		const store = new DisposableStore();
		try {
			const exited = Event.toPromise(instance.onExit, store).then(() => {
				throw new Error(localize('positron.agentTerminal.shellExited', "The shell exited while starting."));
			});
			await Promise.race([instance.processReady, exited]);
			if (instance.capabilities.get(TerminalCapability.CommandDetection)) {
				return;
			}
			const timeoutMs = getShellIntegrationTimeout(this._configurationService, true, instance.hasRemoteAuthority);
			const detected = await raceTimeout(Promise.race([
				Event.toPromise(instance.capabilities.onDidAddCommandDetectionCapability, store).then(() => true),
				exited,
			]), timeoutMs);
			if (!detected) {
				throw new Error(localize('positron.agentTerminal.noSi', "Shell integration didn't start in the terminal within {0} ms. The shell may not support it.", timeoutMs));
			}
		} finally {
			store.dispose();
		}
	}

	async getTerminals(ownerId: string): Promise<IAgentTerminal[]> {
		// Reattached terminals are created and replayed by the time the terminal
		// service is connected; each is taken back once the saved terminals load.
		await this._terminalService.whenConnected;
		await this._saved;
		return [...this._terminals.values()].filter(t => t.ownerId === ownerId).map(t => t.toDto());
	}

	async runCommand(ownerId: string, terminalId: string, commandLine: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		const terminal = this._get(ownerId, terminalId);
		return this._wait(terminal, await terminal.run(commandLine), waitMs, token);
	}

	waitForCommand(ownerId: string, terminalId: string, commandId: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		const terminal = this._get(ownerId, terminalId);
		return this._wait(terminal, terminal.getCommand(commandId), waitMs, token);
	}

	private async _wait(terminal: AgentTerminal, command: AgentCommand, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		if (command.running) {
			await raceCancellation(raceTimeout(command.finished, waitMs), token);
		}
		return terminal.commandDto(command);
	}

	getStatus(ownerId: string, terminalId: string): IAgentTerminalStatus {
		const terminal = this._get(ownerId, terminalId);
		return { exited: terminal.exited, exitCode: terminal.exitCode, commands: terminal.commands.map(c => terminal.commandDto(c)) };
	}

	readOutput(ownerId: string, terminalId: string, commandId: string, offset: number, limit: number): IAgentTerminalOutput {
		const terminal = this._get(ownerId, terminalId);
		const command = terminal.getCommand(commandId);
		const output = terminal.readOutput(command);
		const start = Math.min(Math.max(0, offset), output.lines.length);
		const lines = output.lines.slice(start, start + Math.min(Math.max(1, limit), MAX_READ_LINES));
		const end = start + lines.length;
		return {
			command: command.toDto(output),
			offset: start,
			lines: lines.map(truncateLine),
			nextOffset: end < output.lines.length ? end : undefined,
		};
	}

	async interrupt(ownerId: string, terminalId: string): Promise<void> {
		await this._get(ownerId, terminalId).instance.sendText('\x03', false);
	}

	async show(ownerId: string, terminalId: string, preserveFocus: boolean): Promise<void> {
		const terminal = this._get(ownerId, terminalId);
		if (terminal.exited) {
			throw exitedError();
		}
		this._terminalService.setActiveInstance(terminal.instance);
		await this._terminalService.revealTerminal(terminal.instance, preserveFocus);
	}

	disposeTerminal(ownerId: string, terminalId: string): void {
		const terminal = this._get(ownerId, terminalId);
		this._terminals.delete(terminalId);
		terminal.dispose();
		if (!terminal.instance.isDisposed) {
			terminal.instance.dispose();
		}
	}

	private _get(ownerId: string, terminalId: string): AgentTerminal {
		const terminal = this._terminals.get(terminalId);
		if (!terminal || terminal.ownerId !== ownerId) {
			throw new Error(localize('positron.agentTerminal.notFound', "No agent terminal with ID {0}.", terminalId));
		}
		return terminal;
	}

	override dispose(): void {
		for (const terminal of this._terminals.values()) {
			terminal.dispose();
		}
		this._terminals.clear();
		super.dispose();
	}
}
