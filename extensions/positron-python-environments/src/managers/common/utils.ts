import * as fs from 'fs-extra';
import path from 'path';
import { commands, ConfigurationTarget, l10n, window, workspace } from 'vscode';
import { PythonCommandRunConfiguration, PythonEnvironment, PythonEnvironmentApi } from '../../api';
import { traceLog, traceVerbose } from '../../common/logging';
import { isWindows } from '../../common/utils/platformUtils';
import { ShellConstants } from '../../features/common/shellConstants';
import { getDefaultEnvManagerSetting, setDefaultEnvManagerBroken } from '../../features/settings/settingHelpers';
import { PythonProjectManager } from '../../internal.api';
import { Installable } from './types';

export function noop() {
    // do nothing
}

/**
 * In **contrast** to just checking `typeof` this will return `false` for `NaN`.
 * @returns whether the provided parameter is a JavaScript Number or not.
 */
export function isNumber(obj: unknown): obj is number {
    return typeof obj === 'number' && !isNaN(obj);
}

export function shortVersion(version: string): string {
    const pattern = /(\d)\.(\d+)(?:\.(\d+)?)?/gm;
    const match = pattern.exec(version);
    if (match) {
        if (match[3]) {
            return `${match[1]}.${match[2]}.${match[3]}`;
        }
        return `${match[1]}.${match[2]}.x`;
    }
    return version;
}

export function isGreater(a: string | undefined, b: string | undefined): boolean {
    if (!a && !b) {
        return false;
    }
    if (!a) {
        return false;
    }
    if (!b) {
        return true;
    }

    try {
        const aParts = a.split('.');
        const bParts = b.split('.');
        for (let i = 0; i < aParts.length; i++) {
            if (i >= bParts.length) {
                return true;
            }
            const aPart = parseInt(aParts[i], 10);
            const bPart = parseInt(bParts[i], 10);
            if (aPart > bPart) {
                return true;
            }
            if (aPart < bPart) {
                return false;
            }
        }
    } catch {
        return false;
    }
    return false;
}

export function sortEnvironments(collection: PythonEnvironment[]): PythonEnvironment[] {
    return collection.sort((a, b) => {
        if (a.version !== b.version) {
            return isGreater(a.version, b.version) ? -1 : 1;
        }
        const value = a.name.localeCompare(b.name);
        if (value !== 0) {
            return value;
        }
        return a.environmentPath.fsPath.localeCompare(b.environmentPath.fsPath);
    });
}

export function getLatest(collection: PythonEnvironment[]): PythonEnvironment | undefined {
    if (collection.length === 0) {
        return undefined;
    }
    let latest = collection[0];
    for (const env of collection) {
        if (isGreater(env.version, latest.version)) {
            latest = env;
        }
    }
    return latest;
}

export function mergePackages(common: Installable[], installed: string[]): Installable[] {
    const notInCommon = installed.filter((pkg) => !common.some((c) => c.name === pkg));
    return common
        .concat(notInCommon.map((pkg) => ({ name: pkg, displayName: pkg })))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function pathForGitBash(binPath: string): string {
    return isWindows() ? binPath.replace(/\\/g, '/').replace(/^([a-zA-Z]):/, '/$1') : binPath;
}

/**
 * Compares two semantic version strings. Support sonly simple 1.1.1 style versions.
 * @param version1 First version
 * @param version2 Second version
 * @returns -1 if version1 < version2, 0 if equal, 1 if version1 > version2
 */
export function compareVersions(version1: string, version2: string): number {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;

        if (v1Part > v2Part) {
            return 1;
        }
        if (v1Part < v2Part) {
            return -1;
        }
    }

    return 0;
}

export async function getShellActivationCommands(binDir: string): Promise<{
    shellActivation: Map<string, PythonCommandRunConfiguration[]>;
    shellDeactivation: Map<string, PythonCommandRunConfiguration[]>;
}> {
    const shellActivation: Map<string, PythonCommandRunConfiguration[]> = new Map();
    const shellDeactivation: Map<string, PythonCommandRunConfiguration[]> = new Map();

    if (isWindows()) {
        shellActivation.set('unknown', [{ executable: path.join(binDir, `activate`) }]);
        shellDeactivation.set('unknown', [{ executable: path.join(binDir, `deactivate`) }]);
    } else {
        shellActivation.set('unknown', [{ executable: 'source', args: [path.join(binDir, `activate`)] }]);
        shellDeactivation.set('unknown', [{ executable: 'deactivate' }]);
    }

    shellActivation.set(ShellConstants.SH, [{ executable: 'source', args: [path.join(binDir, `activate`)] }]);
    shellDeactivation.set(ShellConstants.SH, [{ executable: 'deactivate' }]);

    shellActivation.set(ShellConstants.BASH, [{ executable: 'source', args: [path.join(binDir, `activate`)] }]);
    shellDeactivation.set(ShellConstants.BASH, [{ executable: 'deactivate' }]);

    shellActivation.set(ShellConstants.GITBASH, [
        { executable: 'source', args: [pathForGitBash(path.join(binDir, `activate`))] },
    ]);
    shellDeactivation.set(ShellConstants.GITBASH, [{ executable: 'deactivate' }]);

    shellActivation.set(ShellConstants.ZSH, [{ executable: 'source', args: [path.join(binDir, `activate`)] }]);
    shellDeactivation.set(ShellConstants.ZSH, [{ executable: 'deactivate' }]);

    shellActivation.set(ShellConstants.KSH, [{ executable: '.', args: [path.join(binDir, `activate`)] }]);
    shellDeactivation.set(ShellConstants.KSH, [{ executable: 'deactivate' }]);

    if (await fs.pathExists(path.join(binDir, 'Activate.ps1'))) {
        shellActivation.set(ShellConstants.PWSH, [{ executable: '&', args: [path.join(binDir, `Activate.ps1`)] }]);
        shellDeactivation.set(ShellConstants.PWSH, [{ executable: 'deactivate' }]);
    } else if (await fs.pathExists(path.join(binDir, 'activate.ps1'))) {
        shellActivation.set(ShellConstants.PWSH, [{ executable: '&', args: [path.join(binDir, `activate.ps1`)] }]);
        shellDeactivation.set(ShellConstants.PWSH, [{ executable: 'deactivate' }]);
    }

    if (await fs.pathExists(path.join(binDir, 'activate.bat'))) {
        shellActivation.set(ShellConstants.CMD, [{ executable: path.join(binDir, `activate.bat`) }]);
        shellDeactivation.set(ShellConstants.CMD, [{ executable: path.join(binDir, `deactivate.bat`) }]);
    }

    if (await fs.pathExists(path.join(binDir, 'activate.csh'))) {
        shellActivation.set(ShellConstants.CSH, [{ executable: 'source', args: [path.join(binDir, `activate.csh`)] }]);
        shellDeactivation.set(ShellConstants.CSH, [{ executable: 'deactivate' }]);

        shellActivation.set(ShellConstants.FISH, [{ executable: 'source', args: [path.join(binDir, `activate.csh`)] }]);
        shellDeactivation.set(ShellConstants.FISH, [{ executable: 'deactivate' }]);
    }

    if (await fs.pathExists(path.join(binDir, 'activate.fish'))) {
        shellActivation.set(ShellConstants.FISH, [
            { executable: 'source', args: [path.join(binDir, `activate.fish`)] },
        ]);
        shellDeactivation.set(ShellConstants.FISH, [{ executable: 'deactivate' }]);
    }

    if (await fs.pathExists(path.join(binDir, 'activate.xsh'))) {
        shellActivation.set(ShellConstants.XONSH, [
            { executable: 'source', args: [path.join(binDir, `activate.xsh`)] },
        ]);
        shellDeactivation.set(ShellConstants.XONSH, [{ executable: 'deactivate' }]);
    }

    if (await fs.pathExists(path.join(binDir, 'activate.nu'))) {
        shellActivation.set(ShellConstants.NU, [
            { executable: 'overlay', args: ['use', path.join(binDir, 'activate.nu')] },
        ]);
        shellDeactivation.set(ShellConstants.NU, [{ executable: 'overlay', args: ['hide', 'activate'] }]);
    }
    return {
        shellActivation,
        shellDeactivation,
    };
}

// Tracks if the broken defaultEnvManager error message has been shown this session
let hasShownBrokenDefaultEnvManagerError = false;

/**
 * Checks if the given managerId is set as the default environment manager for the project.
 * If so, marks the default manager as broken, refreshes environments, and shows an error message to the user.
 * The error message offers to reset the setting, view the setting, or close.
 * The error message is only shown once per session.
 *
 * @param managerId The environment manager id to check.
 * @param projectManager The Python project manager instance.
 * @param api The Python environment API instance.
 */
export async function notifyMissingManagerIfDefault(
    managerId: string,
    projectManager: PythonProjectManager,
    api: PythonEnvironmentApi,
) {
    const defaultEnvManager = getDefaultEnvManagerSetting(projectManager);
    if (defaultEnvManager === managerId) {
        if (hasShownBrokenDefaultEnvManagerError) {
            return;
        }
        hasShownBrokenDefaultEnvManagerError = true;
        setDefaultEnvManagerBroken(true);
        await api.refreshEnvironments(undefined);
        window
            .showErrorMessage(
                l10n.t(
                    "The default environment manager is set to '{0}', but the {1} executable could not be found.",
                    defaultEnvManager,
                    managerId.split(':')[1],
                ),
                l10n.t('Reset setting'),
                l10n.t('View setting'),
                l10n.t('Close'),
            )
            .then(async (selection) => {
                if (selection === 'Reset setting') {
                    const result = await removeFirstDefaultEnvManagerSettingDetailed(managerId);
                    if (!result.found) {
                        window
                            .showErrorMessage(
                                l10n.t(
                                    "Could not find a setting for 'defaultEnvManager' set to '{0}' to reset.",
                                    managerId,
                                ),
                                l10n.t('Open settings'),
                                l10n.t('Close'),
                            )
                            .then((sel) => {
                                if (sel === 'Open settings') {
                                    commands.executeCommand(
                                        'workbench.action.openSettings',
                                        'python-envs.defaultEnvManager',
                                    );
                                }
                            });
                    }
                }
                if (selection === 'View setting') {
                    commands.executeCommand('workbench.action.openSettings', 'python-envs.defaultEnvManager');
                }
            });
    }
}

/**
 * Removes the first occurrence of 'defaultEnvManager' set to managerId, returns where it was removed, and logs the action.
 * @param managerId The manager id to match and remove.
 * @returns { found: boolean, scope?: string }
 */
export async function removeFirstDefaultEnvManagerSettingDetailed(
    managerId: string,
): Promise<{ found: boolean; scope?: string }> {
    const config = workspace.getConfiguration('python-envs');
    const inspect = config.inspect('defaultEnvManager');

    // Workspace folder settings (multi-root)
    if (inspect?.workspaceFolderValue !== undefined && inspect.workspaceFolderValue === managerId) {
        await config.update('defaultEnvManager', undefined, ConfigurationTarget.WorkspaceFolder);
        traceLog("[python-envs] Removed 'defaultEnvManager' from Workspace Folder settings.");
        return { found: true, scope: 'Workspace Folder' };
    }
    // Workspace settings
    if (inspect?.workspaceValue !== undefined && inspect.workspaceValue === managerId) {
        await config.update('defaultEnvManager', undefined, ConfigurationTarget.Workspace);
        traceLog("[python-envs] Removed 'defaultEnvManager' from Workspace settings.");
        return { found: true, scope: 'Workspace' };
    }
    // User/global settings
    if (inspect?.globalValue !== undefined && inspect.globalValue === managerId) {
        await config.update('defaultEnvManager', undefined, ConfigurationTarget.Global);
        traceLog("[python-envs] Removed 'defaultEnvManager' from User/Global settings.");
        return { found: true, scope: 'User/Global' };
    }
    // No matching setting found
    traceVerbose(`[python-envs] Could not find 'defaultEnvManager' set to '${managerId}' in any scope.`);
    return { found: false };
}
