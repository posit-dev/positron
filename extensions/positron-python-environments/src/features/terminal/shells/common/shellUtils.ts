import { PythonCommandRunConfiguration, PythonEnvironment } from '../../../../api';
import { traceInfo } from '../../../../common/logging';
import { timeout } from '../../../../common/utils/asyncUtils';
import { isWindows } from '../../../../common/utils/platformUtils';
import { activeTerminalShellIntegration } from '../../../../common/window.apis';
import { getConfiguration } from '../../../../common/workspace.apis';
import { ShellConstants } from '../../../common/shellConstants';
import { quoteArgs } from '../../../execution/execUtils';
import { SHELL_INTEGRATION_POLL_INTERVAL, SHELL_INTEGRATION_TIMEOUT } from '../../utils';

function getCommandAsString(command: PythonCommandRunConfiguration[], shell: string, delimiter: string): string {
    const parts = [];
    for (const cmd of command) {
        const args = cmd.args ?? [];
        parts.push(quoteArgs([normalizeShellPath(cmd.executable, shell), ...args]).join(' '));
    }
    if (shell === ShellConstants.PWSH) {
        if (parts.length === 1) {
            return parts[0];
        }
        return parts.map((p) => `(${p})`).join(` ${delimiter} `);
    }
    return parts.join(` ${delimiter} `);
}

export function getShellCommandAsString(shell: string, command: PythonCommandRunConfiguration[]): string {
    switch (shell) {
        case ShellConstants.PWSH:
            return getCommandAsString(command, shell, ';');
        case ShellConstants.NU:
            return getCommandAsString(command, shell, ';');
        case ShellConstants.FISH:
            return getCommandAsString(command, shell, '; and');
        case ShellConstants.BASH:
        case ShellConstants.SH:
        case ShellConstants.ZSH:

        case ShellConstants.CMD:
        case ShellConstants.GITBASH:
        default:
            return getCommandAsString(command, shell, '&&');
    }
}

export function normalizeShellPath(filePath: string, shellType?: string): string {
    if (isWindows() && shellType) {
        if (shellType.toLowerCase() === ShellConstants.GITBASH || shellType.toLowerCase() === 'git-bash') {
            return filePath.replace(/\\/g, '/').replace(/^\/([a-zA-Z])/, '$1:');
        }
    }
    return filePath;
}
export function getShellActivationCommand(
    shell: string,
    environment: PythonEnvironment,
): PythonCommandRunConfiguration[] | undefined {
    let activation: PythonCommandRunConfiguration[] | undefined;
    if (environment.execInfo?.shellActivation) {
        activation = environment.execInfo.shellActivation.get(shell);
        if (!activation) {
            activation = environment.execInfo.shellActivation.get('unknown');
        }
    }

    if (!activation) {
        activation = environment.execInfo?.activation;
    }

    return activation;
}
export function getShellDeactivationCommand(
    shell: string,
    environment: PythonEnvironment,
): PythonCommandRunConfiguration[] | undefined {
    let deactivation: PythonCommandRunConfiguration[] | undefined;
    if (environment.execInfo?.shellDeactivation) {
        deactivation = environment.execInfo.shellDeactivation.get(shell);
        if (!deactivation) {
            deactivation = environment.execInfo.shellDeactivation.get('unknown');
        }
    }

    if (!deactivation) {
        deactivation = environment.execInfo?.deactivation;
    }

    return deactivation;
}

export const PROFILE_TAG_START = '###PATH_START###';
export const PROFILE_TAG_END = '###PATH_END###';
export function extractProfilePath(content: string): string | undefined {
    // Extract only the part between the tags
    const profilePathRegex = new RegExp(`${PROFILE_TAG_START}\\r?\\n(.*?)\\r?\\n${PROFILE_TAG_END}`, 's');
    const match = content?.match(profilePathRegex);

    if (match && match[1]) {
        const extractedPath = match[1].trim();
        return extractedPath;
    }
    return undefined;
}

export async function shellIntegrationForActiveTerminal(name: string, profile?: string): Promise<boolean> {
    let hasShellIntegration = activeTerminalShellIntegration();
    let timeOutstamp = 0;

    while (!hasShellIntegration && timeOutstamp < SHELL_INTEGRATION_TIMEOUT) {
        await timeout(SHELL_INTEGRATION_POLL_INTERVAL);
        timeOutstamp += SHELL_INTEGRATION_POLL_INTERVAL;
        hasShellIntegration = activeTerminalShellIntegration();
    }

    if (hasShellIntegration) {
        traceInfo(
            `SHELL: Shell integration is available on your active terminal, with name ${name} and profile ${profile}. Python activate scripts will be evaluated at shell integration level, except in WSL.`,
        );

        return true;
    }
    return false;
}

export function isWsl(): boolean {
    // WSL sets these environment variables
    return !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || process.env.WSLENV);
}

export async function getShellIntegrationEnabledCache(): Promise<boolean> {
    const shellIntegrationInspect =
        getConfiguration('terminal.integrated').inspect<boolean>('shellIntegration.enabled');

    let shellIntegrationEnabled = true;
    if (shellIntegrationInspect) {
        // Priority: workspaceFolder > workspace > globalRemoteValue > globalLocalValue > global > default
        const inspectValue = shellIntegrationInspect as Record<string, unknown>;

        if (shellIntegrationInspect.workspaceFolderValue !== undefined) {
            shellIntegrationEnabled = shellIntegrationInspect.workspaceFolderValue;
        } else if (shellIntegrationInspect.workspaceValue !== undefined) {
            shellIntegrationEnabled = shellIntegrationInspect.workspaceValue;
        } else if ('globalRemoteValue' in shellIntegrationInspect && inspectValue.globalRemoteValue !== undefined) {
            shellIntegrationEnabled = inspectValue.globalRemoteValue as boolean;
        } else if ('globalLocalValue' in shellIntegrationInspect && inspectValue.globalLocalValue !== undefined) {
            shellIntegrationEnabled = inspectValue.globalLocalValue as boolean;
        } else if (shellIntegrationInspect.globalValue !== undefined) {
            shellIntegrationEnabled = shellIntegrationInspect.globalValue;
        } else if (shellIntegrationInspect.defaultValue !== undefined) {
            shellIntegrationEnabled = shellIntegrationInspect.defaultValue;
        }
    }

    return shellIntegrationEnabled;
}

// Shells that support shell integration way of environment activation.
// CMD is not listed here, but we still want to support activation via profile modification.
export const shellIntegrationSupportedShells = [
    ShellConstants.PWSH,
    ShellConstants.BASH,
    ShellConstants.GITBASH,
    ShellConstants.FISH,
    ShellConstants.ZSH,
];

/**
 * Determines whether profile-based activation should be used instead of shell integration.
 * Profile activation is preferred when:
 * - Running in WSL
 * - The shell type doesn't support shell integration (e.g., cmd)
 */
export function shouldUseProfileActivation(shellType: string): boolean {
    return isWsl() || !shellIntegrationSupportedShells.includes(shellType);
}
