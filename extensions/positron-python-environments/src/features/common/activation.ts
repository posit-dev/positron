import { Terminal } from 'vscode';
import { PythonEnvironment } from '../../api';
import {
    getShellActivationCommand,
    getShellCommandAsString,
    getShellDeactivationCommand,
} from '../terminal/shells/common/shellUtils';
import { identifyTerminalShell } from './shellDetector';

export function isActivatableEnvironment(environment: PythonEnvironment): boolean {
    return !!environment.execInfo?.activation || !!environment.execInfo?.shellActivation;
}

export function isActivatedRunAvailable(environment: PythonEnvironment): boolean {
    return !!environment.execInfo?.activatedRun;
}

export function getActivationCommand(terminal: Terminal, environment: PythonEnvironment): string | undefined {
    const shell = identifyTerminalShell(terminal);
    const command = getShellActivationCommand(shell, environment);
    if (command) {
        return getShellCommandAsString(shell, command);
    }
    return undefined;
}

export function getDeactivationCommand(terminal: Terminal, environment: PythonEnvironment): string | undefined {
    const shell = identifyTerminalShell(terminal);
    const command = getShellDeactivationCommand(shell, environment);
    if (command) {
        return getShellCommandAsString(shell, command);
    }
    return undefined;
}
