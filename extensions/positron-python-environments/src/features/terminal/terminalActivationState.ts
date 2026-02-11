import {
    Disposable,
    Event,
    EventEmitter,
    Terminal,
    TerminalShellExecutionEndEvent,
    TerminalShellExecutionStartEvent,
    TerminalShellIntegration,
} from 'vscode';
import { PythonEnvironment } from '../../api';
import { traceError, traceInfo, traceVerbose } from '../../common/logging';
import { onDidEndTerminalShellExecution, onDidStartTerminalShellExecution } from '../../common/window.apis';
import { getActivationCommand, getDeactivationCommand } from '../common/activation';
import { isTaskTerminal } from './utils';

export interface DidChangeTerminalActivationStateEvent {
    terminal: Terminal;
    environment: PythonEnvironment;
    activated: boolean;
}

export interface TerminalActivation {
    isActivated(terminal: Terminal, environment?: PythonEnvironment): boolean;
    activate(terminal: Terminal, environment: PythonEnvironment): Promise<void>;
    deactivate(terminal: Terminal): Promise<void>;
    onDidChangeTerminalActivationState: Event<DidChangeTerminalActivationStateEvent>;
}

export interface TerminalEnvironment {
    getEnvironment(terminal: Terminal): PythonEnvironment | undefined;
}

export interface TerminalActivationInternal extends TerminalActivation, TerminalEnvironment, Disposable {
    updateActivationState(terminal: Terminal, environment: PythonEnvironment, activated: boolean): void;
}

export class TerminalActivationImpl implements TerminalActivationInternal {
    private disposables: Disposable[] = [];

    private onTerminalShellExecutionStartEmitter = new EventEmitter<TerminalShellExecutionStartEvent>();
    private onTerminalShellExecutionStart = this.onTerminalShellExecutionStartEmitter.event;

    private onTerminalShellExecutionEndEmitter = new EventEmitter<TerminalShellExecutionEndEvent>();
    private onTerminalShellExecutionEnd = this.onTerminalShellExecutionEndEmitter.event;

    private onDidChangeTerminalActivationStateEmitter = new EventEmitter<DidChangeTerminalActivationStateEvent>();
    onDidChangeTerminalActivationState = this.onDidChangeTerminalActivationStateEmitter.event;

    private onTerminalClosedEmitter = new EventEmitter<Terminal>();
    private onTerminalClosed = this.onTerminalClosedEmitter.event;

    private activatedTerminals = new Map<Terminal, PythonEnvironment>();
    private activatingTerminals = new Map<Terminal, Promise<void>>();
    private deactivatingTerminals = new Map<Terminal, Promise<void>>();

    constructor() {
        this.disposables.push(
            this.onDidChangeTerminalActivationStateEmitter,
            this.onTerminalShellExecutionStartEmitter,
            this.onTerminalShellExecutionEndEmitter,
            this.onTerminalClosedEmitter,
            onDidStartTerminalShellExecution((e: TerminalShellExecutionStartEvent) => {
                this.onTerminalShellExecutionStartEmitter.fire(e);
            }),
            onDidEndTerminalShellExecution((e: TerminalShellExecutionEndEvent) => {
                this.onTerminalShellExecutionEndEmitter.fire(e);
            }),
            this.onTerminalClosed((terminal) => {
                this.activatedTerminals.delete(terminal);
                this.activatingTerminals.delete(terminal);
                this.deactivatingTerminals.delete(terminal);
            }),
        );
    }

    isActivated(terminal: Terminal, environment?: PythonEnvironment): boolean {
        if (!environment) {
            return this.activatedTerminals.has(terminal);
        }
        const env = this.activatedTerminals.get(terminal);
        return env?.envId.id === environment?.envId.id;
    }

    getEnvironment(terminal: Terminal): PythonEnvironment | undefined {
        return this.activatedTerminals.get(terminal);
    }

    async activate(terminal: Terminal, environment: PythonEnvironment): Promise<void> {
        if (isTaskTerminal(terminal)) {
            traceVerbose('Cannot activate environment in a task terminal');
            return;
        }

        if (this.deactivatingTerminals.has(terminal)) {
            traceVerbose('Terminal is being deactivated, cannot activate.');
            return this.deactivatingTerminals.get(terminal);
        }

        if (this.activatingTerminals.has(terminal)) {
            traceVerbose('Terminal is being activated, skipping.');
            return this.activatingTerminals.get(terminal);
        }

        const terminalEnv = this.activatedTerminals.get(terminal);
        if (terminalEnv) {
            if (terminalEnv.envId.id === environment.envId.id) {
                traceVerbose('Terminal is already activated with the same environment');
                return;
            } else {
                traceInfo(
                    `Terminal is activated with a different environment, deactivating: ${terminalEnv.environmentPath.fsPath}`,
                );
                await this.deactivate(terminal);
            }
        }

        try {
            const promise = this.activateInternal(terminal, environment);
            traceVerbose(`Activating terminal: ${environment.environmentPath.fsPath}`);
            this.activatingTerminals.set(terminal, promise);
            await promise;
            this.activatingTerminals.delete(terminal);
            this.updateActivationState(terminal, environment, true);
            traceInfo(`Terminal is activated: ${environment.environmentPath.fsPath}`);
        } catch (ex) {
            this.activatingTerminals.delete(terminal);
            traceError('Failed to activate environment:\r\n', ex);
        }
    }

    async deactivate(terminal: Terminal): Promise<void> {
        if (isTaskTerminal(terminal)) {
            traceVerbose('Cannot deactivate environment in a task terminal');
            return;
        }

        if (this.activatingTerminals.has(terminal)) {
            traceVerbose('Terminal is being activated, cannot deactivate.');
            return this.activatingTerminals.get(terminal);
        }

        if (this.deactivatingTerminals.has(terminal)) {
            traceVerbose('Terminal is being deactivated, skipping.');
            return this.deactivatingTerminals.get(terminal);
        }

        const terminalEnv = this.activatedTerminals.get(terminal);
        if (terminalEnv) {
            try {
                const promise = this.deactivateInternal(terminal, terminalEnv);
                traceVerbose(`Deactivating terminal: ${terminalEnv.environmentPath.fsPath}`);
                this.deactivatingTerminals.set(terminal, promise);
                await promise;
                this.deactivatingTerminals.delete(terminal);
                this.updateActivationState(terminal, terminalEnv, false);
                traceInfo(`Terminal is deactivated: ${terminalEnv.environmentPath.fsPath}`);
            } catch (ex) {
                this.deactivatingTerminals.delete(terminal);
                traceError('Failed to deactivate environment:\r\n', ex);
            }
        } else {
            traceVerbose('Terminal is not activated');
        }
    }

    updateActivationState(terminal: Terminal, environment: PythonEnvironment, activated: boolean): void {
        if (activated) {
            this.activatedTerminals.set(terminal, environment);
        } else {
            this.activatedTerminals.delete(terminal);
        }
        setImmediate(() => {
            this.onDidChangeTerminalActivationStateEmitter.fire({ terminal, environment, activated });
        });
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private async activateInternal(terminal: Terminal, environment: PythonEnvironment): Promise<void> {
        if (terminal.shellIntegration) {
            await this.activateUsingShellIntegration(terminal.shellIntegration, terminal, environment);
        } else {
            this.activateLegacy(terminal, environment);
        }
    }

    private async deactivateInternal(terminal: Terminal, environment: PythonEnvironment): Promise<void> {
        if (terminal.shellIntegration) {
            await this.deactivateUsingShellIntegration(terminal.shellIntegration, terminal, environment);
        } else {
            this.deactivateLegacy(terminal, environment);
        }
    }

    private activateLegacy(terminal: Terminal, environment: PythonEnvironment) {
        const activationCommands = getActivationCommand(terminal, environment);
        if (activationCommands) {
            terminal.sendText(activationCommands);
            this.activatedTerminals.set(terminal, environment);
        }
    }

    private deactivateLegacy(terminal: Terminal, environment: PythonEnvironment) {
        const deactivationCommands = getDeactivationCommand(terminal, environment);
        if (deactivationCommands) {
            terminal.sendText(deactivationCommands);
            this.activatedTerminals.delete(terminal);
        }
    }

    private async activateUsingShellIntegration(
        shellIntegration: TerminalShellIntegration,
        terminal: Terminal,
        environment: PythonEnvironment,
    ): Promise<void> {
        const activationCommand = getActivationCommand(terminal, environment);
        if (activationCommand) {
            try {
                await this.executeTerminalShellCommandInternal(shellIntegration, activationCommand);
                this.activatedTerminals.set(terminal, environment);
            } catch {
                traceError('Failed to activate environment using shell integration');
            }
        } else {
            traceVerbose('No activation commands found for terminal.');
        }
    }

    private async deactivateUsingShellIntegration(
        shellIntegration: TerminalShellIntegration,
        terminal: Terminal,
        environment: PythonEnvironment,
    ): Promise<void> {
        const deactivationCommand = getDeactivationCommand(terminal, environment);
        if (deactivationCommand) {
            try {
                await this.executeTerminalShellCommandInternal(shellIntegration, deactivationCommand);
                this.activatedTerminals.delete(terminal);
            } catch {
                traceError('Failed to deactivate environment using shell integration');
            }
        } else {
            traceVerbose('No deactivation commands found for terminal.');
        }
    }

    private async executeTerminalShellCommandInternal(
        shellIntegration: TerminalShellIntegration,
        command: string,
    ): Promise<boolean> {
        const execution = shellIntegration.executeCommand(command);
        const disposables: Disposable[] = [];

        const promise = new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                traceError(`Shell execution timed out: ${command}`);
                resolve();
            }, 2000);

            disposables.push(
                new Disposable(() => clearTimeout(timer)),
                this.onTerminalShellExecutionEnd((e: TerminalShellExecutionEndEvent) => {
                    if (e.execution === execution) {
                        resolve();
                    }
                }),
                this.onTerminalShellExecutionStart((e: TerminalShellExecutionStartEvent) => {
                    if (e.execution === execution) {
                        traceVerbose(`Shell execution started: ${command}`);
                    }
                }),
            );
        });

        try {
            await promise;
            return true;
        } catch {
            traceError(`Failed to execute shell command: ${command}`);
            return false;
        } finally {
            disposables.forEach((d) => d.dispose());
        }
    }
}
