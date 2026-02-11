import * as path from 'path';
import { Disposable, env, Terminal, TerminalOptions, Uri } from 'vscode';
import { PythonEnvironment, PythonProject, PythonProjectEnvironmentApi, PythonProjectGetterApi } from '../../api';
import { timeout } from '../../common/utils/asyncUtils';
import { createSimpleDebounce } from '../../common/utils/debounce';
import { onDidChangeTerminalShellIntegration, onDidWriteTerminalData } from '../../common/window.apis';
import { getConfiguration, getWorkspaceFolders } from '../../common/workspace.apis';

export const SHELL_INTEGRATION_TIMEOUT = 500; // 0.5 seconds
export const SHELL_INTEGRATION_POLL_INTERVAL = 20; // 0.02 seconds

/**
 * Three conditions in a Promise.race:
 * 1. Timeout based on VS Code's terminal.integrated.shellIntegration.timeout setting
 * 2. Shell integration becoming available (window.onDidChangeTerminalShellIntegration event)
 * 3. Detection of common prompt patterns in terminal output
 */
export async function waitForShellIntegration(terminal: Terminal): Promise<boolean> {
    if (terminal.shellIntegration) {
        return true;
    }

    const config = getConfiguration('terminal.integrated');
    const shellIntegrationEnabled = config.get<boolean>('shellIntegration.enabled', true);
    const timeoutValue = config.get<number | undefined>('shellIntegration.timeout');
    const isRemote = env.remoteName !== undefined;
    let timeoutMs: number;
    if (typeof timeoutValue !== 'number' || timeoutValue < 0) {
        timeoutMs = shellIntegrationEnabled ? 5000 : isRemote ? 3000 : 2000;
    } else {
        timeoutMs = Math.max(timeoutValue, 500);
    }

    const disposables: Disposable[] = [];

    try {
        const result = await Promise.race([
            // Condition 1: Shell integration timeout setting
            timeout(timeoutMs).then(() => false),

            // Condition 2: Shell integration becomes available
            new Promise<boolean>((resolve) => {
                disposables.push(
                    onDidChangeTerminalShellIntegration((e) => {
                        if (e.terminal === terminal) {
                            resolve(true);
                        }
                    }),
                );
            }),

            // Condition 3: Detect prompt patterns in terminal output
            new Promise<boolean>((resolve) => {
                const dataEvents: string[] = [];
                const debounced = createSimpleDebounce(50, () => {
                    if (dataEvents && detectsCommonPromptPattern(dataEvents.join(''))) {
                        resolve(false);
                    }
                });
                disposables.push(debounced);
                disposables.push(
                    onDidWriteTerminalData((e) => {
                        if (e.terminal === terminal) {
                            dataEvents.push(e.data);
                            debounced.trigger();
                        }
                    }),
                );
            }),
        ]);

        return result;
    } finally {
        disposables.forEach((d) => d.dispose());
    }
}

// Detects if the given text content appears to end with a common prompt pattern.
function detectsCommonPromptPattern(terminalData: string): boolean {
    if (terminalData.trim().length === 0) {
        return false;
    }

    const sanitizedTerminalData = removeAnsiEscapeCodes(terminalData);
    // PowerShell prompt: PS C:\> or similar patterns
    if (/PS\s+[A-Z]:\\.*>\s*$/.test(sanitizedTerminalData)) {
        return true;
    }

    // Command Prompt: C:\path>
    if (/^[A-Z]:\\.*>\s*$/.test(sanitizedTerminalData)) {
        return true;
    }

    // Bash-style prompts ending with $
    if (/\$\s*$/.test(sanitizedTerminalData)) {
        return true;
    }

    // Root prompts ending with #
    if (/#\s*$/.test(sanitizedTerminalData)) {
        return true;
    }

    // Python REPL prompt
    if (/^>>>\s*$/.test(sanitizedTerminalData)) {
        return true;
    }

    // Custom prompts ending with the starship character (\u276f)
    if (/\u276f\s*$/.test(sanitizedTerminalData)) {
        return true;
    }

    // Generic prompts ending with common prompt characters
    if (/[>%]\s*$/.test(sanitizedTerminalData)) {
        return true;
    }

    return false;
}

export function isTaskTerminal(terminal: Terminal): boolean {
    // TODO: Need API for core for this https://github.com/microsoft/vscode/issues/234440
    return terminal.name.toLowerCase().includes('task');
}

export function getTerminalCwd(terminal: Terminal): string | undefined {
    if (terminal.shellIntegration?.cwd) {
        return terminal.shellIntegration.cwd.fsPath;
    }
    const cwd = (terminal.creationOptions as TerminalOptions)?.cwd;
    if (cwd) {
        return typeof cwd === 'string' ? cwd : cwd.fsPath;
    }
    return undefined;
}

async function getDistinctProjectEnvs(
    api: PythonProjectEnvironmentApi,
    projects: readonly PythonProject[],
): Promise<PythonEnvironment[]> {
    const envs: PythonEnvironment[] = [];
    await Promise.all(
        projects.map(async (p) => {
            const e = await api.getEnvironment(p.uri);
            if (e && !envs.find((x) => x.envId.id === e.envId.id)) {
                envs.push(e);
            }
        }),
    );
    return envs;
}

export async function getEnvironmentForTerminal(
    api: PythonProjectGetterApi & PythonProjectEnvironmentApi,
    terminal?: Terminal,
): Promise<PythonEnvironment | undefined> {
    let env: PythonEnvironment | undefined;

    const projects = api.getPythonProjects();
    if (projects.length === 0) {
        env = await api.getEnvironment(undefined);
    } else if (projects.length === 1) {
        env = await api.getEnvironment(projects[0].uri);
    } else {
        const envs = await getDistinctProjectEnvs(api, projects);
        if (envs.length === 1) {
            // If we have only one distinct environment, then use that.
            env = envs[0];
        } else {
            // If we have multiple distinct environments, then we can't pick one
            // So skip selecting so we can try heuristic approach
            env = undefined;
        }
    }

    if (env) {
        return env;
    }

    // This is a heuristic approach to attempt to find the environment for this terminal.
    // This is not guaranteed to work, but is better than nothing.
    const terminalCwd = terminal ? getTerminalCwd(terminal) : undefined;
    if (terminalCwd) {
        env = await api.getEnvironment(Uri.file(path.resolve(terminalCwd)));
    } else {
        const workspaces = getWorkspaceFolders() ?? [];
        if (workspaces.length === 1) {
            env = await api.getEnvironment(workspaces[0].uri);
        }
    }

    return env;
}

export const ACT_TYPE_SHELL = 'shellStartup';
export const ACT_TYPE_COMMAND = 'command';
export const ACT_TYPE_OFF = 'off';
export type AutoActivationType = 'off' | 'command' | 'shellStartup';
/**
 * Determines the auto-activation type for Python environments in terminals.
 *
 * The following types are supported:
 * - 'shellStartup': Environment is activated via shell startup scripts
 * - 'command': Environment is activated via explicit command
 * - 'off': Auto-activation is disabled
 *
 * Priority order:
 * 1. python-envs.terminal.autoActivationType
 *    a. globalRemoteValue
 *    b. globalLocalValue
 *    c. globalValue
 * 2. python.terminal.activateEnvironment setting (if false, returns 'off' & sets autoActivationType to 'off')
 * 3. Default to 'command' if no setting is found
 *
 * @returns {AutoActivationType} The determined auto-activation type
 */
export function getAutoActivationType(): AutoActivationType {
    const pyEnvsConfig = getConfiguration('python-envs');
    const pyEnvsActivationType = pyEnvsConfig.inspect<AutoActivationType>('terminal.autoActivationType');

    if (pyEnvsActivationType) {
        // Priority order: globalRemoteValue > globalLocalValue > globalValue
        const activationType = pyEnvsActivationType as Record<string, unknown>;

        if ('globalRemoteValue' in pyEnvsActivationType && activationType.globalRemoteValue !== undefined) {
            return activationType.globalRemoteValue as AutoActivationType;
        }
        if ('globalLocalValue' in pyEnvsActivationType && activationType.globalLocalValue !== undefined) {
            return activationType.globalLocalValue as AutoActivationType;
        }
        if (pyEnvsActivationType.globalValue !== undefined) {
            return pyEnvsActivationType.globalValue;
        }
    }

    // If none of the python-envs settings are defined, check the legacy python setting
    const pythonConfig = getConfiguration('python');
    const pythonActivateSetting = pythonConfig.get<boolean | undefined>('terminal.activateEnvironment', undefined);
    if (pythonActivateSetting === false) {
        // Set autoActivationType to 'off' if python.terminal.activateEnvironment is false
        pyEnvsConfig.update('terminal.autoActivationType', ACT_TYPE_OFF);
        return ACT_TYPE_OFF;
    }

    // Default to 'command' if no settings are found or if pythonActivateSetting is true/undefined
    return ACT_TYPE_COMMAND;
}

export async function setAutoActivationType(value: AutoActivationType): Promise<void> {
    const config = getConfiguration('python-envs');
    return await config.update('terminal.autoActivationType', value, true);
}

export async function getAllDistinctProjectEnvironments(
    api: PythonProjectGetterApi & PythonProjectEnvironmentApi,
): Promise<PythonEnvironment[] | undefined> {
    const envs: PythonEnvironment[] | undefined = [];

    const projects = api.getPythonProjects();
    if (projects.length === 0) {
        const env = await api.getEnvironment(undefined);
        if (env) {
            envs.push(env);
        }
    } else if (projects.length === 1) {
        const env = await api.getEnvironment(projects[0].uri);
        if (env) {
            envs.push(env);
        }
    } else {
        envs.push(...(await getDistinctProjectEnvs(api, projects)));
    }

    return envs.length > 0 ? envs : undefined;
}

// Defacto standard: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
const CSI_SEQUENCE = /(?:\x1b\[|\x9b)[=?>!]?[\d;:]*["$#'* ]?[a-zA-Z@^`{}|~]/;
const OSC_SEQUENCE = /(?:\x1b\]|\x9d).*?(?:\x1b\\|\x07|\x9c)/;
const ESC_SEQUENCE = /\x1b(?:[ #%\(\)\*\+\-\.\/]?[a-zA-Z0-9\|}~@])/;
const CONTROL_SEQUENCES = new RegExp(
    '(?:' + [CSI_SEQUENCE.source, OSC_SEQUENCE.source, ESC_SEQUENCE.source].join('|') + ')',
    'g',
);

/**
 * Strips ANSI escape sequences from a string.
 * @param str The dastringa stringo strip the ANSI escape sequences from.
 *
 * @example
 * removeAnsiEscapeCodes('\u001b[31mHello, World!\u001b[0m');
 * // 'Hello, World!'
 */
export function removeAnsiEscapeCodes(str: string): string {
    if (str) {
        str = str.replace(CONTROL_SEQUENCES, '');
    }

    return str;
}
