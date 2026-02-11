import * as fsapi from 'fs-extra';
import * as path from 'path';
import { Disposable, EventEmitter, ProgressLocation, Terminal, TerminalOptions, Uri } from 'vscode';
import { PythonEnvironment, PythonEnvironmentApi, PythonProject, PythonTerminalCreateOptions } from '../../api';
import { ActivationStrings } from '../../common/localize';
import { traceInfo, traceVerbose } from '../../common/logging';
import {
    createTerminal,
    onDidChangeWindowState,
    onDidCloseTerminal,
    onDidOpenTerminal,
    terminals,
    withProgress,
} from '../../common/window.apis';
import { getConfiguration, onDidChangeConfiguration } from '../../common/workspace.apis';
import { isActivatableEnvironment } from '../common/activation';
import { identifyTerminalShell } from '../common/shellDetector';
import { getPythonApi } from '../pythonApi';
import {
    getShellIntegrationEnabledCache,
    isWsl,
    shellIntegrationForActiveTerminal,
    shouldUseProfileActivation,
} from './shells/common/shellUtils';
import { ShellEnvsProvider, ShellSetupState, ShellStartupScriptProvider } from './shells/startupProvider';
import { handleSettingUpShellProfile } from './shellStartupSetupHandlers';
import {
    DidChangeTerminalActivationStateEvent,
    TerminalActivation,
    TerminalActivationInternal,
    TerminalEnvironment,
} from './terminalActivationState';
import {
    ACT_TYPE_COMMAND,
    ACT_TYPE_OFF,
    ACT_TYPE_SHELL,
    AutoActivationType,
    getAutoActivationType,
    getEnvironmentForTerminal,
    waitForShellIntegration,
} from './utils';

export interface TerminalCreation {
    create(environment: PythonEnvironment, options: PythonTerminalCreateOptions): Promise<Terminal>;
}

export interface TerminalGetters {
    getProjectTerminal(
        project: Uri | PythonProject,
        environment: PythonEnvironment,
        createNew?: boolean,
    ): Promise<Terminal>;
    getDedicatedTerminal(
        terminalKey: Uri | string,
        project: Uri | PythonProject,
        environment: PythonEnvironment,
        createNew?: boolean,
    ): Promise<Terminal>;
}

export interface TerminalInit {
    initialize(api: PythonEnvironmentApi): Promise<void>;
}

export interface TerminalManager
    extends TerminalEnvironment,
        TerminalInit,
        TerminalActivation,
        TerminalCreation,
        TerminalGetters,
        Disposable {}

export class TerminalManagerImpl implements TerminalManager {
    private disposables: Disposable[] = [];
    private skipActivationOnOpen = new Set<Terminal>();
    private shellSetup: Map<string, boolean> = new Map<string, boolean>();

    private onTerminalOpenedEmitter = new EventEmitter<Terminal>();
    private onTerminalOpened = this.onTerminalOpenedEmitter.event;

    private onTerminalClosedEmitter = new EventEmitter<Terminal>();
    private onTerminalClosed = this.onTerminalClosedEmitter.event;

    private onDidChangeTerminalActivationStateEmitter = new EventEmitter<DidChangeTerminalActivationStateEvent>();
    public onDidChangeTerminalActivationState = this.onDidChangeTerminalActivationStateEmitter.event;

    private hasFocus = true;

    constructor(
        private readonly ta: TerminalActivationInternal,
        private readonly startupEnvProviders: ShellEnvsProvider[],
        private readonly startupScriptProviders: ShellStartupScriptProvider[],
    ) {
        this.disposables.push(
            this.onTerminalOpenedEmitter,
            this.onTerminalClosedEmitter,
            this.onDidChangeTerminalActivationStateEmitter,
            onDidOpenTerminal((t: Terminal) => {
                this.onTerminalOpenedEmitter.fire(t);
            }),
            onDidCloseTerminal((t: Terminal) => {
                this.onTerminalClosedEmitter.fire(t);
            }),
            this.onTerminalOpened(async (t) => {
                if (this.skipActivationOnOpen.has(t) || (t.creationOptions as TerminalOptions)?.hideFromUser) {
                    return;
                }
                let env = this.ta.getEnvironment(t);
                if (!env) {
                    const api = await getPythonApi();
                    env = await getEnvironmentForTerminal(api, t);
                }
                if (env) {
                    await this.autoActivateOnTerminalOpen(t, env);
                }
            }),
            this.onTerminalClosed((t) => {
                this.skipActivationOnOpen.delete(t);
            }),
            this.ta.onDidChangeTerminalActivationState((e) => {
                this.onDidChangeTerminalActivationStateEmitter.fire(e);
            }),
            onDidChangeConfiguration(async (e) => {
                if (e.affectsConfiguration('python-envs.terminal.autoActivationType')) {
                    const actType = getAutoActivationType();
                    if (actType === ACT_TYPE_SHELL) {
                        traceInfo(`Auto activation type changed to ${actType}`);
                        const shells = new Set(
                            terminals()
                                .map((t) => identifyTerminalShell(t))
                                .filter((t) => t !== 'unknown'),
                        );
                        if (shells.size > 0) {
                            await this.handleSetupCheck(shells);
                        }
                    } else {
                        traceVerbose(
                            `Auto activation type changed to ${actType}, not tearing down shell startup scripts on activation type switch; scripts are only removed via explicit revert.`,
                        );
                    }
                }
            }),
            onDidChangeWindowState((e) => {
                this.hasFocus = e.focused;
            }),
        );
    }

    private async handleSetupCheck(shellType: string | Set<string>): Promise<void> {
        const shellTypes = typeof shellType === 'string' ? new Set([shellType]) : shellType;
        const providers = this.startupScriptProviders.filter((p) => shellTypes.has(p.shellType));
        if (providers.length > 0) {
            const shellsToSetup: ShellStartupScriptProvider[] = [];
            await Promise.all(
                providers.map(async (p) => {
                    const state = await p.isSetup();
                    const shellIntegrationEnabledSetting = await getShellIntegrationEnabledCache();
                    const shellIntegrationActiveTerminal = await shellIntegrationForActiveTerminal(p.name);
                    const shellIntegrationLikelyAvailable =
                        shellIntegrationEnabledSetting || shellIntegrationActiveTerminal;
                    traceVerbose(`Checking shell profile for ${p.shellType}, with state: ${state}`);

                    if (state === ShellSetupState.NotSetup) {
                        traceVerbose(
                            `WSL detected: ${isWsl()}, Shell integration available from setting, or active terminal: ${shellIntegrationEnabledSetting}, or ${await shellIntegrationForActiveTerminal(
                                p.name,
                            )}`,
                        );

                        if (shellIntegrationLikelyAvailable && !shouldUseProfileActivation(p.shellType)) {
                            // Shell integration available and NOT in WSL - skip setup.
                            // NOTE: We intentionally do NOT teardown scripts here. If the user stays in
                            // shellStartup mode, be less aggressive about clearing profile modifications.
                            this.shellSetup.set(p.shellType, true);
                            traceVerbose(
                                `Shell integration likely available. Skipping setup of shell profile for ${p.shellType}.`,
                            );
                        } else {
                            // WSL (regardless of integration) OR no/disabled shell integration - needs setup
                            this.shellSetup.set(p.shellType, false);
                            shellsToSetup.push(p);
                            traceVerbose(
                                `Shell integration is NOT available or disabled. Shell profile for ${p.shellType} is not setup.`,
                            );
                        }
                    } else if (state === ShellSetupState.Setup) {
                        this.shellSetup.set(p.shellType, true);
                        traceVerbose(`Shell profile for ${p.shellType} is setup.`);
                    } else if (state === ShellSetupState.NotInstalled) {
                        this.shellSetup.set(p.shellType, false);
                        traceVerbose(`Shell profile for ${p.shellType} is not installed.`);
                    }
                }),
            );

            if (shellsToSetup.length === 0) {
                traceVerbose(`No shell profiles to setup for ${Array.from(shellTypes).join(', ')}`);
                return;
            }

            if (!this.hasFocus) {
                traceVerbose('Window does not have focus, skipping shell profile setup');
                return;
            }

            setImmediate(async () => {
                // Avoid blocking this setup on user interaction.
                await handleSettingUpShellProfile(shellsToSetup, (p, v) => this.shellSetup.set(p.shellType, v));
            });
        }
    }

    private getShellActivationType(shellType: string): AutoActivationType | undefined {
        let isSetup = this.shellSetup.get(shellType);
        if (isSetup === true) {
            traceVerbose(`Shell profile for ${shellType} is already setup.`);
            return ACT_TYPE_SHELL;
        } else if (isSetup === false) {
            traceVerbose(`Shell profile for ${shellType} is not set up, using command fallback.`);
            return ACT_TYPE_COMMAND;
        }
    }

    private async getEffectiveActivationType(shellType: string): Promise<AutoActivationType> {
        const providers = this.startupScriptProviders.filter((p) => p.shellType === shellType);
        if (providers.length > 0) {
            traceVerbose(`Shell startup is supported for ${shellType}, using shell startup activation`);
            let isSetup = this.getShellActivationType(shellType);
            if (isSetup !== undefined) {
                return isSetup;
            }

            await this.handleSetupCheck(shellType);

            // Check again after the setup check.
            return this.getShellActivationType(shellType) ?? ACT_TYPE_COMMAND;
        }
        traceInfo(`Shell startup not supported for ${shellType}, using command activation as fallback`);
        return ACT_TYPE_COMMAND;
    }

    private async autoActivateOnTerminalOpen(terminal: Terminal, environment: PythonEnvironment): Promise<void> {
        let actType = getAutoActivationType();
        const shellType = identifyTerminalShell(terminal);
        if (actType === ACT_TYPE_SHELL) {
            await this.handleSetupCheck(shellType);
            actType = await this.getEffectiveActivationType(shellType);
        }

        if (actType === ACT_TYPE_COMMAND) {
            if (isActivatableEnvironment(environment)) {
                await withProgress(
                    {
                        location: ProgressLocation.Window,
                        title: `${ActivationStrings.activatingEnvironment}: ${environment.environmentPath.fsPath}`,
                    },
                    async () => {
                        await waitForShellIntegration(terminal);
                        await this.activate(terminal, environment);
                    },
                );
            } else {
                traceVerbose(`Environment ${environment.environmentPath.fsPath} is not activatable`);
            }
        } else if (actType === ACT_TYPE_OFF) {
            traceInfo(`"python-envs.terminal.autoActivationType" is set to "${actType}", skipping auto activation`);
        } else if (actType === ACT_TYPE_SHELL) {
            traceInfo(
                `"python-envs.terminal.autoActivationType" is set to "${actType}", terminal should be activated by shell startup script`,
            );
        }
    }

    public async create(environment: PythonEnvironment, options: PythonTerminalCreateOptions): Promise<Terminal> {
        const autoActType = getAutoActivationType();
        let envVars = options.env;
        if (autoActType === ACT_TYPE_SHELL) {
            const vars = await Promise.all(this.startupEnvProviders.map((p) => p.getEnvVariables(environment)));

            vars.forEach((varMap) => {
                if (varMap) {
                    varMap.forEach((value, key) => {
                        envVars = { ...envVars, [key]: value };
                    });
                }
            });
        }

        // Uncomment the code line below after the issue is resolved:
        // https://github.com/microsoft/vscode-python-environments/issues/172
        // const name = options.name ?? `Python: ${environment.displayName}`;
        const newTerminal = createTerminal({
            ...options,
            env: envVars,
        });

        if (autoActType === ACT_TYPE_COMMAND) {
            if (options.disableActivation) {
                this.skipActivationOnOpen.add(newTerminal);
                return newTerminal;
            }

            // We add it to skip activation on open to prevent double activation.
            // We can activate it ourselves since we are creating it.
            this.skipActivationOnOpen.add(newTerminal);
            await this.autoActivateOnTerminalOpen(newTerminal, environment);
        }

        return newTerminal;
    }

    private dedicatedTerminals = new Map<string, Terminal>();
    async getDedicatedTerminal(
        terminalKey: Uri,
        project: Uri | PythonProject,
        environment: PythonEnvironment,
        createNew: boolean = false,
    ): Promise<Terminal> {
        const part = terminalKey instanceof Uri ? path.normalize(terminalKey.fsPath) : terminalKey;
        const key = `${environment.envId.id}:${part}`;
        if (!createNew) {
            const terminal = this.dedicatedTerminals.get(key);
            if (terminal) {
                return terminal;
            }
        }

        const puri = project instanceof Uri ? project : project.uri;
        const config = getConfiguration('python', terminalKey);
        const projectStat = await fsapi.stat(puri.fsPath);
        const projectDir = projectStat.isDirectory() ? puri.fsPath : path.dirname(puri.fsPath);

        const uriStat = await fsapi.stat(terminalKey.fsPath);
        const uriDir = uriStat.isDirectory() ? terminalKey.fsPath : path.dirname(terminalKey.fsPath);
        const cwd = config.get<boolean>('terminal.executeInFileDir', false) ? uriDir : projectDir;

        const newTerminal = await this.create(environment, { cwd });
        this.dedicatedTerminals.set(key, newTerminal);

        const disable = onDidCloseTerminal((terminal) => {
            if (terminal === newTerminal) {
                this.dedicatedTerminals.delete(key);
                disable.dispose();
            }
        });

        return newTerminal;
    }

    private projectTerminals = new Map<string, Terminal>();
    async getProjectTerminal(
        project: Uri | PythonProject,
        environment: PythonEnvironment,
        createNew: boolean = false,
    ): Promise<Terminal> {
        const uri = project instanceof Uri ? project : project.uri;
        const key = `${environment.envId.id}:${path.normalize(uri.fsPath)}`;
        if (!createNew) {
            const terminal = this.projectTerminals.get(key);
            if (terminal) {
                return terminal;
            }
        }
        const stat = await fsapi.stat(uri.fsPath);
        const cwd = stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
        const newTerminal = await this.create(environment, { cwd });
        this.projectTerminals.set(key, newTerminal);

        const disable = onDidCloseTerminal((terminal) => {
            if (terminal === newTerminal) {
                this.projectTerminals.delete(key);
                disable.dispose();
            }
        });

        return newTerminal;
    }

    private async activateUsingCommand(api: PythonEnvironmentApi, t: Terminal): Promise<void> {
        this.skipActivationOnOpen.add(t);

        const env = this.ta.getEnvironment(t) ?? (await getEnvironmentForTerminal(api, t));

        if (env && isActivatableEnvironment(env)) {
            await this.activate(t, env);
        }
    }

    public async initialize(api: PythonEnvironmentApi): Promise<void> {
        const actType = getAutoActivationType();
        if (actType === ACT_TYPE_COMMAND) {
            await Promise.all(terminals().map(async (t) => this.activateUsingCommand(api, t)));
        } else if (actType === ACT_TYPE_SHELL) {
            const shells = new Set(
                terminals()
                    .map((t) => identifyTerminalShell(t))
                    .filter((t) => t !== 'unknown'),
            );
            if (shells.size > 0) {
                await this.handleSetupCheck(shells);
                await Promise.all(
                    terminals().map(async (t) => {
                        // If the shell is not set up, we activate using command fallback.
                        if (this.shellSetup.get(identifyTerminalShell(t)) === false) {
                            await this.activateUsingCommand(api, t);
                        }
                    }),
                );
            }
        }
    }

    public getEnvironment(terminal: Terminal): PythonEnvironment | undefined {
        return this.ta.getEnvironment(terminal);
    }

    public activate(terminal: Terminal, environment: PythonEnvironment): Promise<void> {
        return this.ta.activate(terminal, environment);
    }

    public deactivate(terminal: Terminal): Promise<void> {
        return this.ta.deactivate(terminal);
    }

    isActivated(terminal: Terminal, environment?: PythonEnvironment): boolean {
        return this.ta.isActivated(terminal, environment);
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}
