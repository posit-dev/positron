/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceCancellation, raceTimeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { PromptInputState } from '../../../../platform/terminal/common/capabilities/commandDetection/promptInputModel.js';
import { TerminalSettingId } from '../../../../platform/terminal/common/terminal.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { getShellIntegrationTimeout } from '../../terminal/common/terminalEnvironment.js';
import { ISerializedOutputLines, OutputLines, ShellStreamParser } from '../common/agentTerminalOutput.js';
import { IAgentTerminal, IAgentTerminalCommand, IAgentTerminalCreateOptions, IAgentTerminalOutput, IPositronAgentTerminalService, MAX_READ_LINES } from '../common/agentTerminalService.js';

/** How many commands a terminal remembers, dropping the oldest. */
const MAX_COMMANDS = 50;

/** How long to wait for the shell to report that a command it was sent started. */
const COMMAND_START_TIMEOUT_MS = 10_000;

/** How many lines of each command's output are saved across a window reload. */
const MAX_SAVED_LINES = 1_000;

/** Prefix of the ephemeral state key, per workspace, that holds agent terminals across a window reload. */
const SAVED_TERMINALS_KEY = 'positron.agentTerminals';

interface ISavedAgentCommand {
	readonly id: string;
	readonly commandLine: string;
	readonly startTime: number;
	readonly endTime?: number;
	readonly exitCode?: number;
	readonly missingOutput: boolean;
	readonly output: ISerializedOutputLines;
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
	readonly output: OutputLines;
	readonly startTime: number;
	endTime: number | undefined;
	exitCode: number | undefined;
	missingOutput: boolean;
	private readonly _finished = new DeferredPromise<void>();

	constructor(readonly id: string, readonly commandLine: string, saved?: ISavedAgentCommand) {
		this.output = saved ? OutputLines.deserialize(saved.output) : new OutputLines();
		this.startTime = saved?.startTime ?? Date.now();
		this.endTime = saved?.endTime;
		this.exitCode = saved?.exitCode;
		this.missingOutput = saved?.missingOutput ?? false;
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

	finish(exitCode: number | undefined): void {
		if (this.running) {
			this.output.end();
			this.exitCode = exitCode;
			this.endTime = Date.now();
			this._finished.complete();
		}
	}

	toDto(): IAgentTerminalCommand {
		return {
			id: this.id,
			commandLine: this.commandLine,
			running: this.running,
			exitCode: this.exitCode,
			startTime: this.startTime,
			endTime: this.endTime,
			lineCount: this.output.lineCount,
			droppedLines: this.output.droppedLines,
			missingOutput: this.missingOutput,
		};
	}

	serialize(): ISavedAgentCommand {
		return {
			id: this.id,
			commandLine: this.commandLine,
			startTime: this.startTime,
			endTime: this.endTime,
			exitCode: this.exitCode,
			missingOutput: this.missingOutput,
			output: this.output.serialize(MAX_SAVED_LINES),
		};
	}
}

/**
 * Restores an agent terminal whose shell outlived a window reload. The
 * terminal's replay of its scrollback is not new output, so data is ignored
 * until it completes; `dataAfterReplay` is live data that arrived after it.
 */
interface IAdoption {
	readonly saved: ISavedAgentTerminal;
	readonly replayed: boolean;
	readonly dataAfterReplay: readonly string[];
}

/** Tracks one agent terminal's commands from its raw data stream. */
class AgentTerminal extends Disposable implements IAgentTerminal {
	readonly id: string;
	exited = false;
	exitCode: number | undefined;

	private readonly _parser = new ShellStreamParser();
	private readonly _commands: AgentCommand[] = [];
	private _nextCommandId = 1;
	private _current: AgentCommand | undefined;
	/**
	 * A command line being run that hasn't started yet. Until it is `sent`, shell
	 * markers belong to the prompt before it, such as the first prompt's `D`.
	 */
	private _pending: { commandLine: string; sent: boolean; started: DeferredPromise<AgentCommand> } | undefined;
	/** The command line the shell last reported, for commands not sent through this class. */
	private _reportedCommandLine: string | undefined;
	private _replaying: boolean;

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
				const command = new AgentCommand(saved.id, saved.commandLine, saved);
				this._commands.push(command);
				if (command.running) {
					this._current = command;
				}
			}
		}
		this._register(instance.onWillData(data => this._onData(data)));
		this._register(instance.onExit(e => this._onExit(typeof e === 'number' ? e : undefined)));
		this._register(instance.onDisposed(() => this._onExit(undefined)));
		if (this._replaying) {
			this._register(Event.once(instance.onProcessReplayComplete)(() => {
				this._replaying = false;
				this._reconcile();
			}));
		} else if (adoption) {
			this._reconcile();
			adoption.dataAfterReplay.forEach(data => this._onData(data));
		}
	}

	/**
	 * After a reload, settles the command that was running. Its output from
	 * during the reload is lost. If the shell had no child processes when it
	 * reattached, the command finished meanwhile; its exit code is the last
	 * command the restored shell integration state lists, when that is this
	 * command. Otherwise it is still running, or a background helper the shell
	 * keeps makes it look so; interrupting it settles it either way.
	 */
	private _reconcile(): void {
		const current = this._current;
		if (!current) {
			return;
		}
		current.missingOutput = true;
		if (this.instance.shellLaunchConfig.attachPersistentProcess?.hasChildProcesses === false) {
			const last = this.instance.capabilities.get(TerminalCapability.CommandDetection)?.commands.at(-1);
			current.finish(last?.command.trim() === current.commandLine.trim() ? last.exitCode : undefined);
			this._current = undefined;
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

	async run(commandLine: string): Promise<AgentCommand> {
		if (this.exited) {
			throw new Error(localize('positron.agentTerminal.exited', "The terminal has exited."));
		}
		if (this._current || this._pending) {
			throw new Error(localize('positron.agentTerminal.busy', "A command is already running in this terminal. Wait for it to finish or interrupt it."));
		}
		this._pending = { commandLine, sent: false, started: new DeferredPromise<AgentCommand>() };
		const pending = this._pending;
		try {
			// Lines sent one by one run as separate commands; a paste runs as one.
			const multiline = /(?<!\\)\n/.test(commandLine.replace(/\r\n?/g, '\n'));
			if (multiline && !await this._acceptsPaste()) {
				throw new Error(localize('positron.agentTerminal.noPaste', "This shell would run each line of the command separately. Join the lines with `;` or `&&`, or put them in a script."));
			}
			await this.instance.runCommand(commandLine, true, undefined, multiline);
			pending.sent = true;
			const command = await raceTimeout(pending.started.p, COMMAND_START_TIMEOUT_MS);
			if (!command) {
				throw new Error(localize('positron.agentTerminal.noStart', "The shell didn't report the command starting."));
			}
			return command;
		} finally {
			if (this._pending === pending) {
				this._pending = undefined;
			}
		}
	}

	/** Whether the shell takes bracketed paste, which it turns on before each prompt. */
	private async _acceptsPaste(): Promise<boolean> {
		const prompt = this.instance.capabilities.get(TerminalCapability.CommandDetection)?.promptInputModel;
		if (prompt && prompt.state !== PromptInputState.Input) {
			const store = new DisposableStore();
			await raceTimeout(Event.toPromise(prompt.onDidStartInput, store), COMMAND_START_TIMEOUT_MS);
			store.dispose();
		}
		const xterm = await this.instance.xtermReadyPromise;
		return xterm?.raw.modes.bracketedPasteMode === true;
	}

	private _onData(data: string): void {
		if (this._replaying) {
			return;
		}
		for (const token of this._parser.parse(data)) {
			switch (token.type) {
				case 'text':
					this._current?.output.append(token.text);
					break;
				case 'commandLine':
					this._reportedCommandLine = token.commandLine;
					break;
				case 'executed':
					this._current?.finish(undefined);
					this._current = this._startCommand();
					break;
				case 'finished':
					// A command that ends without starting, such as an empty line, still answers a pending run.
					(this._current ?? (this._pending?.sent ? this._startCommand() : undefined))?.finish(token.exitCode);
					this._current = undefined;
					break;
			}
		}
	}

	private _startCommand(): AgentCommand {
		const pending = this._pending?.sent ? this._pending : undefined;
		const command = new AgentCommand(String(this._nextCommandId++), pending?.commandLine ?? this._reportedCommandLine ?? '');
		this._reportedCommandLine = undefined;
		this._commands.push(command);
		const finished = this._commands.filter(c => !c.running);
		if (this._commands.length > MAX_COMMANDS && finished.length) {
			this._commands.splice(this._commands.indexOf(finished[0]), 1);
		}
		if (pending) {
			pending.started.complete(command);
			this._pending = undefined;
		}
		return command;
	}

	private _onExit(exitCode: number | undefined): void {
		if (this.exited) {
			return;
		}
		this.exited = true;
		this.exitCode = exitCode;
		this._current?.finish(undefined);
		this._current = undefined;
		this._pending?.started.error(new Error(localize('positron.agentTerminal.exited', "The terminal has exited.")));
		this._pending = undefined;
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
		// Collect what happens while the saved terminals load.
		const store = new DisposableStore();
		const dataAfterReplay: string[] = [];
		store.add(instance.onProcessReplayComplete(() => replayed = true));
		store.add(instance.onWillData(data => {
			if (replayed) {
				dataAfterReplay.push(data);
			}
		}));
		void this._saved.then(saved => {
			store.dispose();
			const record = saved?.[processId];
			if (!record || instance.isDisposed || this._terminals.has(record.id)) {
				return;
			}
			const terminal = new AgentTerminal(record.ownerId, record.name, instance, { saved: record, replayed, dataAfterReplay });
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
				env: options.env,
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

	getTerminals(ownerId: string): IAgentTerminal[] {
		return [...this._terminals.values()].filter(t => t.ownerId === ownerId).map(t => t.toDto());
	}

	async runCommand(ownerId: string, terminalId: string, commandLine: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		const command = await this._get(ownerId, terminalId).run(commandLine);
		return this._wait(command, waitMs, token);
	}

	waitForCommand(ownerId: string, terminalId: string, commandId: string, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		return this._wait(this._get(ownerId, terminalId).getCommand(commandId), waitMs, token);
	}

	private async _wait(command: AgentCommand, waitMs: number, token: CancellationToken): Promise<IAgentTerminalCommand> {
		if (command.running) {
			await raceCancellation(raceTimeout(command.finished, waitMs), token);
		}
		return command.toDto();
	}

	getCommands(ownerId: string, terminalId: string): IAgentTerminalCommand[] {
		return this._get(ownerId, terminalId).commands.map(c => c.toDto());
	}

	readOutput(ownerId: string, terminalId: string, commandId: string, offset: number, limit: number): IAgentTerminalOutput {
		const command = this._get(ownerId, terminalId).getCommand(commandId);
		const read = command.output.read(Math.max(0, offset), Math.min(Math.max(1, limit), MAX_READ_LINES));
		const end = read.offset + read.lines.length;
		return {
			command: command.toDto(),
			offset: read.offset,
			lines: read.lines,
			nextOffset: end < command.output.lineCount ? end : undefined,
		};
	}

	async interrupt(ownerId: string, terminalId: string): Promise<void> {
		await this._get(ownerId, terminalId).instance.sendText('\x03', false);
	}

	async show(ownerId: string, terminalId: string, preserveFocus: boolean): Promise<void> {
		const terminal = this._get(ownerId, terminalId);
		if (terminal.exited) {
			throw new Error(localize('positron.agentTerminal.exited', "The terminal has exited."));
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
