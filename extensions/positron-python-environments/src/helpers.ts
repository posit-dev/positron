import { ExtensionContext, extensions, QuickInputButtons, Uri, window, workspace } from 'vscode';
import { PythonEnvironment, PythonEnvironmentApi } from './api';
import { traceError, traceInfo, traceWarn } from './common/logging';
import { normalizePath } from './common/utils/pathUtils';
import { isWindows } from './common/utils/platformUtils';
import { createTerminal, showInputBoxWithButtons } from './common/window.apis';
import { getConfiguration } from './common/workspace.apis';
import { ShellConstants } from './features/common/shellConstants';
import { identifyTerminalShell } from './features/common/shellDetector';
import { quoteArgs } from './features/execution/execUtils';
import { getAutoActivationType } from './features/terminal/utils';
import { EnvironmentManagers, PythonProjectManager } from './internal.api';
import { getNativePythonToolsPath, NativeEnvInfo, NativePythonFinder } from './managers/common/nativePythonFinder';

/**
 * Collects relevant Python environment information for issue reporting
 */
export async function collectEnvironmentInfo(
    context: ExtensionContext,
    envManagers: EnvironmentManagers,
    projectManager: PythonProjectManager,
): Promise<string> {
    const info: string[] = [];

    try {
        // Extension version
        const extensionVersion = context.extension?.packageJSON?.version || 'unknown';
        info.push(`Extension Version: ${extensionVersion}`);

        // Python extension version
        const pythonExtension = extensions.getExtension('ms-python.python');
        const pythonVersion = pythonExtension?.packageJSON?.version || 'not installed';
        info.push(`Python Extension Version: ${pythonVersion}`);

        // Environment managers
        const managers = envManagers.managers;
        info.push(`\nRegistered Environment Managers (${managers.length}):`);
        managers.forEach((manager) => {
            info.push(`  - ${manager.id} (${manager.displayName})`);
        });

        // Available environments
        const allEnvironments: PythonEnvironment[] = [];
        for (const manager of managers) {
            try {
                const envs = await manager.getEnvironments('all');
                allEnvironments.push(...envs);
            } catch (err) {
                info.push(`  Error getting environments from ${manager.id}: ${err}`);
            }
        }

        info.push(`\nTotal Available Environments: ${allEnvironments.length}`);
        if (allEnvironments.length > 0) {
            info.push('Environment Details:');
            allEnvironments.slice(0, 10).forEach((env, index) => {
                info.push(`  ${index + 1}. ${env.displayName} (${env.version}) - ${env.displayPath}`);
            });
            if (allEnvironments.length > 10) {
                info.push(`  ... and ${allEnvironments.length - 10} more environments`);
            }
        }

        // Python projects
        const projects = projectManager.getProjects();
        info.push(`\nPython Projects (${projects.length}):`);
        for (let index = 0; index < projects.length; index++) {
            const project = projects[index];
            info.push(`  ${index + 1}. ${project.uri.fsPath}`);
            try {
                const env = await envManagers.getEnvironment(project.uri);
                if (env) {
                    info.push(`     Environment: ${env.displayName}`);
                }
            } catch (err) {
                info.push(`     Error getting environment: ${err}`);
            }
        }

        // Current settings (non-sensitive)
        const config = workspace.getConfiguration('python-envs');
        const pyConfig = workspace.getConfiguration('python');
        info.push('\nExtension Settings:');
        info.push(`  Default Environment Manager: ${config.get('defaultEnvManager')}`);
        info.push(`  Default Package Manager: ${config.get('defaultPackageManager')}`);
        const pyenvAct = config.get('terminal.autoActivationType', undefined);
        const pythonAct = pyConfig.get('terminal.activateEnvironment', undefined);
        info.push(
            `Auto-activation is "${getAutoActivationType()}". Activation based on first 'py-env.terminal.autoActivationType' setting which is '${pyenvAct}' and 'python.terminal.activateEnvironment' if the first is undefined which is '${pythonAct}'.\n`,
        );
    } catch (err) {
        info.push(`\nError collecting environment information: ${err}`);
    }

    return info.join('\n');
}

/**
 * Logs the values of defaultPackageManager and defaultEnvManager at all configuration levels (workspace folder, workspace, user/global, default).
 */
export function getEnvManagerAndPackageManagerConfigLevels() {
    const config = getConfiguration('python-envs');
    const envManagerInspect = config.inspect<string>('defaultEnvManager');
    const pkgManagerInspect = config.inspect<string>('defaultPackageManager');

    return {
        section: 'Python Envs Configuration Levels',
        defaultEnvManager: {
            workspaceFolderValue: envManagerInspect?.workspaceFolderValue ?? 'undefined',
            workspaceValue: envManagerInspect?.workspaceValue ?? 'undefined',
            globalValue: envManagerInspect?.globalValue ?? 'undefined',
            defaultValue: envManagerInspect?.defaultValue ?? 'undefined',
        },
        defaultPackageManager: {
            workspaceFolderValue: pkgManagerInspect?.workspaceFolderValue ?? 'undefined',
            workspaceValue: pkgManagerInspect?.workspaceValue ?? 'undefined',
            globalValue: pkgManagerInspect?.globalValue ?? 'undefined',
            defaultValue: pkgManagerInspect?.defaultValue ?? 'undefined',
        },
    };
}

/**
 * Returns the user-configured value for a configuration key if set at any level (workspace folder, workspace, or global),
 * otherwise returns undefined.
 */
export function getUserConfiguredSetting<T>(section: string, key: string): T | undefined {
    const config = getConfiguration(section);
    const inspect = config.inspect<T>(key);
    if (!inspect) {
        return undefined;
    }
    if (inspect.workspaceFolderValue !== undefined) {
        return inspect.workspaceFolderValue;
    }
    if (inspect.workspaceValue !== undefined) {
        return inspect.workspaceValue;
    }
    if (inspect.globalValue !== undefined) {
        return inspect.globalValue;
    }
    return undefined;
}

/**
 * Runs the Python Environment Tool (PET) in a terminal window, allowing users to
 * execute various PET commands like finding all Python environments or resolving
 * the details of a specific environment.
 *
 *
 * @returns A Promise that resolves when the PET command has been executed or cancelled
 */
export async function runPetInTerminalImpl(): Promise<void> {
    const petPath = await getNativePythonToolsPath();

    // Show quick pick menu for PET operation selection
    const selectedOption = await window.showQuickPick(
        [
            {
                label: 'Find All Environments',
                description: 'Finds all environments and reports them to the standard output',
                detail: 'Runs: pet find --verbose',
            },
            {
                label: 'Resolve Environment...',
                description: 'Resolves & reports the details of the environment to the standard output',
                detail: 'Runs: pet resolve <path>',
            },
        ],
        {
            placeHolder: 'Select a Python Environment Tool (PET) operation',
            ignoreFocusOut: true,
        },
    );

    if (!selectedOption) {
        return; // User cancelled
    }

    if (selectedOption.label === 'Find All Environments') {
        // Create and show terminal immediately for 'Find All Environments' option
        const terminal = createTerminal({
            name: 'Python Environment Tool (PET)',
        });
        terminal.show();

        // Run pet find --verbose
        const shellType = identifyTerminalShell(terminal);
        const executable = petPath;
        const args = ['find', '--verbose'];
        if (terminal.shellIntegration) {
            // use shell integration if available
            terminal.shellIntegration.executeCommand(executable, args);
        } else {
            let text = quoteArgs([executable, ...args]).join(' ');
            if (shellType === ShellConstants.PWSH && !text.startsWith('&')) {
                text = `& ${text}`;
            }
            terminal.sendText(text, true);
        }
        traceInfo(`Running PET find command: ${petPath} find --verbose`);
    } else if (selectedOption.label === 'Resolve Environment...') {
        try {
            // Show input box for path with back button
            const placeholder = isWindows() ? 'C:\\path\\to\\python\\executable' : '/path/to/python/executable';
            const inputPath = await showInputBoxWithButtons({
                prompt: 'Enter the path to the Python executable to resolve',
                placeHolder: placeholder,
                ignoreFocusOut: true,
                showBackButton: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Please enter a valid path';
                    }
                    return null;
                },
            });

            if (inputPath) {
                // Only create and show terminal after path has been entered
                const terminal = createTerminal({
                    name: 'Python Environment Tool (PET)',
                });
                terminal.show();

                // Run pet resolve with the provided path
                const shellType = identifyTerminalShell(terminal);
                const executable = petPath;
                const args = ['resolve', inputPath.trim()];
                if (terminal.shellIntegration) {
                    terminal.shellIntegration.executeCommand(executable, args);
                } else {
                    let text = quoteArgs([executable, ...args]).join(' ');
                    if (shellType === ShellConstants.PWSH && !text.startsWith('&')) {
                        text = `& ${text}`;
                    }
                    terminal.sendText(text, true);
                }
                traceInfo(`Running PET resolve command: ${petPath} resolve "${inputPath.trim()}"`);
            }
        } catch (ex) {
            if (ex === QuickInputButtons.Back) {
                // If back button was clicked, restart the flow
                await runPetInTerminalImpl();
                return;
            }
            throw ex; // Re-throw other errors
        }
    }
}

/**
 * Sets the default Python interpreter for the workspace if the user has not explicitly set 'defaultEnvManager'.
 * @param nativeFinder -  used to resolve interpreter paths.
 * @param envManagers - contains all registered managers.
 * @param api - The PythonEnvironmentApi for environment resolution and setting.
 */
export async function resolveDefaultInterpreter(
    nativeFinder: NativePythonFinder,
    envManagers: EnvironmentManagers,
    api: PythonEnvironmentApi,
) {
    const userSetdefaultInterpreter = getUserConfiguredSetting<string>('python', 'defaultInterpreterPath');
    const userSetDefaultManager = getUserConfiguredSetting<string>('python-envs', 'defaultEnvManager');
    traceInfo(
        `[resolveDefaultInterpreter] User configured defaultInterpreterPath: ${userSetdefaultInterpreter} and defaultEnvManager: ${userSetDefaultManager}`,
    );

    // Only proceed if the user has explicitly set defaultInterpreterPath but nothing is saved for defaultEnvManager
    if (userSetdefaultInterpreter && !userSetDefaultManager) {
        try {
            const resolved: NativeEnvInfo = await nativeFinder.resolve(userSetdefaultInterpreter);
            if (resolved && resolved.executable) {
                if (normalizePath(resolved.executable) === normalizePath(userSetdefaultInterpreter)) {
                    // no action required, the path is already correct
                    return;
                }
                const resolvedEnv = await api.resolveEnvironment(Uri.file(resolved.executable));
                traceInfo(`[resolveDefaultInterpreter] API resolved environment: ${JSON.stringify(resolvedEnv)}`);

                let findEnvManager = envManagers.managers.find((m) => m.id === resolvedEnv?.envId.managerId);
                if (!findEnvManager) {
                    findEnvManager = envManagers.managers.find((m) => m.id === 'ms-python.python:system');
                }
                const randomString = Math.random().toString(36).substring(2, 15);
                if (resolvedEnv) {
                    const newEnv: PythonEnvironment = {
                        envId: {
                            id: `${userSetdefaultInterpreter}_${randomString}`,
                            managerId: resolvedEnv?.envId.managerId ?? '',
                        },
                        name: 'defaultInterpreterPath: ' + (resolved.version ?? ''),
                        displayName: 'defaultInterpreterPath: ' + (resolved.version ?? ''),
                        version: resolved.version ?? '',
                        displayPath: userSetdefaultInterpreter ?? '',
                        environmentPath: userSetdefaultInterpreter ? Uri.file(userSetdefaultInterpreter) : Uri.file(''),
                        sysPrefix: resolved.arch ?? '',
                        execInfo: {
                            run: {
                                executable: userSetdefaultInterpreter ?? '',
                            },
                        },
                    };
                    if (workspace.workspaceFolders?.[0] && findEnvManager) {
                        traceInfo(
                            `[resolveDefaultInterpreter] Setting environment for workspace: ${workspace.workspaceFolders[0].uri.fsPath}`,
                        );
                        await api.setEnvironment(workspace.workspaceFolders[0].uri, newEnv);
                    }
                }
            } else {
                traceWarn(
                    `[resolveDefaultInterpreter] NativeFinder did not resolve an executable for path: ${userSetdefaultInterpreter}`,
                );
            }
        } catch (err) {
            traceError(`[resolveDefaultInterpreter] Error resolving default interpreter: ${err}`);
        }
    }
}
