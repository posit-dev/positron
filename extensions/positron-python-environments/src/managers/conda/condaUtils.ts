import * as ch from 'child_process';
import * as fse from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
    CancellationError,
    CancellationToken,
    l10n,
    LogOutputChannel,
    ProgressLocation,
    QuickInputButtons,
    QuickPickItem,
    ThemeIcon,
    Uri,
} from 'vscode';
import which from 'which';
import {
    EnvironmentManager,
    Package,
    PackageManagementOptions,
    PackageManager,
    PythonCommandRunConfiguration,
    PythonEnvironment,
    PythonEnvironmentApi,
    PythonEnvironmentInfo,
    PythonProject,
} from '../../api';
import { ENVS_EXTENSION_ID, EXTENSION_ROOT_DIR } from '../../common/constants';
import { showErrorMessageWithLogs } from '../../common/errors/utils';
import { Common, CondaStrings, PackageManagement, Pickers } from '../../common/localize';
import { traceError, traceInfo, traceVerbose, traceWarn } from '../../common/logging';
import { getWorkspacePersistentState } from '../../common/persistentState';
import { pickProject } from '../../common/pickers/projects';
import { StopWatch } from '../../common/stopWatch';
import { createDeferred } from '../../common/utils/deferred';
import { untildify } from '../../common/utils/pathUtils';
import { isWindows } from '../../common/utils/platformUtils';
import {
    showErrorMessage,
    showInputBoxWithButtons,
    showQuickPickWithButtons,
    withProgress,
} from '../../common/window.apis';
import { getConfiguration } from '../../common/workspace.apis';
import { ShellConstants } from '../../features/common/shellConstants';
import { quoteArgs, quoteStringIfNecessary } from '../../features/execution/execUtils';
import {
    isNativeEnvInfo,
    NativeEnvInfo,
    NativeEnvManagerInfo,
    NativePythonEnvironmentKind,
    NativePythonFinder,
} from '../common/nativePythonFinder';
import { selectFromCommonPackagesToInstall } from '../common/pickers';
import { Installable } from '../common/types';
import { shortVersion, sortEnvironments } from '../common/utils';
import { CondaEnvManager } from './condaEnvManager';
import { getCondaHookPs1Path, getLocalActivationScript } from './condaSourcingUtils';
import { createStepBasedCondaFlow } from './condaStepBasedFlow';

export const CONDA_PATH_KEY = `${ENVS_EXTENSION_ID}:conda:CONDA_PATH`;
export const CONDA_PREFIXES_KEY = `${ENVS_EXTENSION_ID}:conda:CONDA_PREFIXES`;
export const CONDA_WORKSPACE_KEY = `${ENVS_EXTENSION_ID}:conda:WORKSPACE_SELECTED`;
export const CONDA_GLOBAL_KEY = `${ENVS_EXTENSION_ID}:conda:GLOBAL_SELECTED`;

let condaPath: string | undefined;
export async function clearCondaCache(): Promise<void> {
    condaPath = undefined;
}

async function setConda(conda: string): Promise<void> {
    condaPath = conda;
    const state = await getWorkspacePersistentState();
    await state.set(CONDA_PATH_KEY, conda);
}

export function getCondaPathSetting(): string | undefined {
    const config = getConfiguration('python');
    const value = config.get<string>('condaPath');
    return value && typeof value === 'string' ? untildify(value) : value;
}

export async function getCondaForWorkspace(fsPath: string): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } | undefined = await state.get(CONDA_WORKSPACE_KEY);
    if (data) {
        try {
            return data[fsPath];
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export async function setCondaForWorkspace(fsPath: string, condaEnvPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(CONDA_WORKSPACE_KEY)) ?? {};
    if (condaEnvPath) {
        data[fsPath] = condaEnvPath;
    } else {
        delete data[fsPath];
    }
    await state.set(CONDA_WORKSPACE_KEY, data);
}

export async function setCondaForWorkspaces(fsPath: string[], condaEnvPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(CONDA_WORKSPACE_KEY)) ?? {};
    fsPath.forEach((s) => {
        if (condaEnvPath) {
            data[s] = condaEnvPath;
        } else {
            delete data[s];
        }
    });
    await state.set(CONDA_WORKSPACE_KEY, data);
}

export async function getCondaForGlobal(): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    return await state.get(CONDA_GLOBAL_KEY);
}

export async function setCondaForGlobal(condaEnvPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    await state.set(CONDA_GLOBAL_KEY, condaEnvPath);
}

async function findConda(): Promise<readonly string[] | undefined> {
    try {
        return await which('conda', { all: true });
    } catch {
        return undefined;
    }
}

async function getCondaExecutable(native?: NativePythonFinder): Promise<string> {
    if (condaPath) {
        if (await fse.pathExists(untildify(condaPath))) {
            traceInfo(`Using conda from cache: ${condaPath}`);
            return untildify(condaPath);
        }
    }

    const state = await getWorkspacePersistentState();
    condaPath = await state.get<string>(CONDA_PATH_KEY);
    if (condaPath) {
        if (await fse.pathExists(untildify(condaPath))) {
            traceInfo(`Using conda from persistent state: ${condaPath}`);
            return untildify(condaPath);
        }
    }

    const paths = await findConda();
    if (paths && paths.length > 0) {
        for (let i = 0; i < paths.length; i++) {
            condaPath = paths[i];
            if (await fse.pathExists(untildify(condaPath))) {
                traceInfo(`Using conda from PATH: ${condaPath}`);
                await state.set(CONDA_PATH_KEY, condaPath);
                return condaPath;
            }
        }
    }

    if (native) {
        const data = await native.refresh(false);
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'conda');
        if (managers.length > 0) {
            for (let i = 0; i < managers.length; i++) {
                condaPath = managers[i].executable;
                if (await fse.pathExists(untildify(condaPath))) {
                    traceInfo(`Using conda from native finder: ${condaPath}`);
                    await state.set(CONDA_PATH_KEY, condaPath);
                    return condaPath;
                }
            }
        }
    }

    throw new Error('Conda not found');
}

export async function getConda(native?: NativePythonFinder): Promise<string> {
    const conda = getCondaPathSetting();
    if (conda) {
        traceInfo(`Using conda from settings: ${conda}`);
        return conda;
    }

    return await getCondaExecutable(native);
}

async function _runConda(
    conda: string,
    args: string[],
    log?: LogOutputChannel,
    token?: CancellationToken,
): Promise<string> {
    const deferred = createDeferred<string>();
    args = quoteArgs(args);
    const quotedConda = quoteStringIfNecessary(conda);
    const timer = new StopWatch();
    deferred.promise.finally(() => traceInfo(`Ran conda in ${timer.elapsedTime}: ${quotedConda} ${args.join(' ')}`));
    const proc = ch.spawn(quotedConda, args, { shell: true });

    token?.onCancellationRequested(() => {
        proc.kill();
        deferred.reject(new CancellationError());
    });

    proc.on('error', (err) => {
        log?.error(`Error spawning conda: ${err}`);
        deferred.reject(new Error(`Error spawning conda: ${err.message}`));
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => {
        const d = data.toString('utf-8');
        stdout += d;
        log?.info(d.trim());
    });
    proc.stderr?.on('data', (data) => {
        const d = data.toString('utf-8');
        stderr += d;
        log?.error(d.trim());
    });
    proc.on('close', () => {
        deferred.resolve(stdout);
    });
    proc.on('exit', (code) => {
        if (code !== 0) {
            deferred.reject(new Error(`Failed to run "conda ${args.join(' ')}":\n ${stderr}`));
        }
    });

    return deferred.promise;
}

async function runConda(args: string[], log?: LogOutputChannel, token?: CancellationToken): Promise<string> {
    const conda = await getConda();
    return await _runConda(conda, args, log, token);
}

export async function runCondaExecutable(
    args: string[],
    log?: LogOutputChannel,
    token?: CancellationToken,
): Promise<string> {
    const conda = await getCondaExecutable(undefined);
    return await _runConda(conda, args, log, token);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCondaInfo(): Promise<any> {
    const raw = await runConda(['info', '--envs', '--json']);
    return JSON.parse(raw);
}

let prefixes: string[] | undefined;
export async function getPrefixes(): Promise<string[]> {
    if (prefixes) {
        return prefixes;
    }

    const state = await getWorkspacePersistentState();
    prefixes = await state.get<string[]>(CONDA_PREFIXES_KEY);
    if (prefixes) {
        return prefixes;
    }

    try {
        const data = await getCondaInfo();
        prefixes = Array.isArray(data['envs_dirs']) ? (data['envs_dirs'] as string[]) : [];
        if (prefixes.length === 0) {
            traceWarn('Conda info returned no environment directories (envs_dirs)');
        }
        await state.set(CONDA_PREFIXES_KEY, prefixes);
    } catch (error) {
        traceError('Failed to get conda environment prefixes', error);
        prefixes = [];
    }
    return prefixes;
}

export async function getDefaultCondaPrefix(): Promise<string> {
    const prefixes = await getPrefixes();
    return prefixes.length > 0 ? prefixes[0] : path.join(os.homedir(), '.conda', 'envs');
}

export async function getVersion(root: string): Promise<string> {
    const files = await fse.readdir(path.join(root, 'conda-meta'));
    for (let file of files) {
        if (file.startsWith('python-3') && file.endsWith('.json')) {
            const content = fse.readJsonSync(path.join(root, 'conda-meta', file));
            return content['version'] as string;
        }
    }

    throw new Error('Python version not found');
}

function isPrefixOf(roots: string[], e: string): boolean {
    if (!roots || !Array.isArray(roots)) {
        return false;
    }
    const t = path.normalize(e);
    for (let r of roots.map((r) => path.normalize(r))) {
        if (t.startsWith(r)) {
            return true;
        }
    }
    return false;
}

/**
 * Creates a PythonEnvironmentInfo object for a named conda environment.
 * @param name The name of the conda environment
 * @param prefix The installation prefix path for the environment
 * @param executable The path to the Python executable
 * @param version The Python version string
 * @param _conda The path to the conda executable (TODO: currently unused)
 * @param envManager The environment manager instance
 * @returns Promise resolving to a PythonEnvironmentInfo object
 */
export async function getNamedCondaPythonInfo(
    name: string,
    prefix: string,
    executable: string,
    version: string,
    _conda: string, // TODO:: fix this, why is it not being used to build the info object
    envManager: EnvironmentManager,
): Promise<PythonEnvironmentInfo> {
    const { shellActivation, shellDeactivation } = await buildShellActivationMapForConda(prefix, envManager, name);
    const sv = shortVersion(version);

    return {
        name: name,
        environmentPath: Uri.file(prefix),
        displayName: `${name} (${sv})`,
        shortDisplayName: `${name}:${sv}`,
        displayPath: prefix,
        description: undefined,
        tooltip: prefix,
        version: version,
        sysPrefix: prefix,
        execInfo: {
            run: { executable: path.join(executable) },
            activatedRun: {
                executable: path.join(executable),
                args: [],
            },
            activation: [{ executable: 'conda', args: ['activate', name] }],
            deactivation: [{ executable: 'conda', args: ['deactivate'] }],
            shellActivation,
            shellDeactivation,
        },
        group: name !== 'base' ? 'Named' : undefined,
    };
}
/**
 * Creates a PythonEnvironmentInfo object for a conda environment specified by prefix path.
 * @param prefix The installation prefix path for the environment
 * @param executable The path to the Python executable
 * @param version The Python version string
 * @param conda The path to the conda executable
 * @param envManager The environment manager instance
 * @returns Promise resolving to a PythonEnvironmentInfo object
 */
export async function getPrefixesCondaPythonInfo(
    prefix: string,
    executable: string,
    version: string,
    conda: string,
    envManager: EnvironmentManager,
): Promise<PythonEnvironmentInfo> {
    const sv = shortVersion(version);

    const { shellActivation, shellDeactivation } = await buildShellActivationMapForConda(prefix, envManager);

    const basename = path.basename(prefix);
    return {
        name: basename,
        environmentPath: Uri.file(prefix),
        displayName: `${basename} (${sv})`,
        shortDisplayName: `${basename}:${sv}`,
        displayPath: prefix,
        description: undefined,
        tooltip: prefix,
        version: version,
        sysPrefix: prefix,
        execInfo: {
            run: { executable: path.join(executable) },
            activatedRun: {
                executable: path.join(executable),
                args: [],
            },
            activation: [{ executable: conda, args: ['activate', prefix] }],
            deactivation: [{ executable: conda, args: ['deactivate'] }],
            shellActivation,
            shellDeactivation,
        },
        group: 'Prefix',
    };
}
interface ShellCommandMaps {
    shellActivation: Map<string, PythonCommandRunConfiguration[]>;
    shellDeactivation: Map<string, PythonCommandRunConfiguration[]>;
}
/**
 * Generates shell-specific activation and deactivation command maps for a conda environment.
 * Creates appropriate activation/deactivation commands based on the environment type (named or prefix),
 * platform (Windows/non-Windows), and available sourcing scripts.
 *
 * @param prefix The conda environment prefix path (installation location)
 * @param envManager The conda environment manager instance
 * @param name Optional name of the conda environment. If provided, used instead of prefix for activation
 * @returns Promise resolving to shell-specific activation/deactivation command maps
 */
async function buildShellActivationMapForConda(
    prefix: string,
    envManager: EnvironmentManager,
    name?: string,
): Promise<ShellCommandMaps> {
    const logs: string[] = [];
    let shellMaps: ShellCommandMaps;

    try {
        // Determine the environment identifier to use
        const envIdentifier = name ? name : prefix;

        logs.push(`Environment Configuration:
    - Identifier: "${envIdentifier}"
    - Prefix: "${prefix}"
    - Name: "${name ?? 'undefined'}"
`);

        let condaCommonActivate: PythonCommandRunConfiguration | undefined = {
            executable: 'conda',
            args: ['activate', envIdentifier],
        };
        let condaCommonDeactivate: PythonCommandRunConfiguration | undefined = {
            executable: 'conda',
            args: ['deactivate'],
        };

        if (!(envManager instanceof CondaEnvManager) || !envManager.sourcingInformation) {
            logs.push('Error: Conda environment manager is not available, using default conda activation paths');
            shellMaps = await generateShellActivationMapFromConfig([condaCommonActivate], [condaCommonDeactivate]);
            return shellMaps;
        }

        const { isActiveOnLaunch, globalSourcingScript } = envManager.sourcingInformation;

        // P1: first check to see if conda is already active in the whole VS Code workspace via sourcing info (set at startup)
        if (isActiveOnLaunch) {
            logs.push('✓ Conda already active on launch, using default activation commands');
            shellMaps = await generateShellActivationMapFromConfig([condaCommonActivate], [condaCommonDeactivate]);
            return shellMaps;
        }

        // get the local activation path, if exists use this
        let localSourcingPath: string | undefined;
        try {
            localSourcingPath = await getLocalActivationScript(prefix);
        } catch (err) {
            logs.push(`Error getting local activation script: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }

        logs.push(`Local Activation:
    - Status: ${localSourcingPath ? 'Found' : 'Not Found'}
    - Path: ${localSourcingPath ?? 'N/A'}
`);

        // Determine the preferred sourcing path with preference to local
        const preferredSourcingPath = localSourcingPath || globalSourcingScript;
        logs.push(`Preferred Sourcing:
    - Selected Path: ${preferredSourcingPath ?? 'none found'}
    - Source: ${localSourcingPath ? 'Local' : globalSourcingScript ? 'Global' : 'None'}
`);

        // P2: Return shell activation if we have no sourcing
        if (!preferredSourcingPath) {
            logs.push('No sourcing path found, using default conda activation');
            shellMaps = await generateShellActivationMapFromConfig([condaCommonActivate], [condaCommonDeactivate]);
            return shellMaps;
        }

        // P3: Handle Windows specifically ;this is carryover from vscode-python
        if (isWindows()) {
            logs.push('✓ Using Windows-specific activation configuration');
            shellMaps = await windowsExceptionGenerateConfig(
                preferredSourcingPath,
                envIdentifier,
                envManager.sourcingInformation.condaFolder,
            );
            return shellMaps;
        }

        logs.push('✓ Using source command with preferred path');
        const condaSourcingPathFirst = {
            executable: 'source',
            args: [preferredSourcingPath, envIdentifier],
        };
        shellMaps = await generateShellActivationMapFromConfig([condaSourcingPathFirst], [condaCommonDeactivate]);
        return shellMaps;
    } catch (error) {
        logs.push(
            `Error in shell activation map generation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Fall back to default conda activation in case of error
        shellMaps = await generateShellActivationMapFromConfig(
            [{ executable: 'conda', args: ['activate', name || prefix] }],
            [{ executable: 'conda', args: ['deactivate'] }],
        );
        return shellMaps;
    } finally {
        // Always print logs in a nicely formatted block, even if there was an error
        traceInfo(
            [
                '=== Conda Shell Activation Map Generation ===',
                ...logs,
                '==========================================',
            ].join('\n'),
        );
    }
}

async function generateShellActivationMapFromConfig(
    activate: PythonCommandRunConfiguration[],
    deactivate: PythonCommandRunConfiguration[],
): Promise<ShellCommandMaps> {
    const shellActivation: Map<string, PythonCommandRunConfiguration[]> = new Map();
    const shellDeactivation: Map<string, PythonCommandRunConfiguration[]> = new Map();
    shellActivation.set(ShellConstants.GITBASH, activate);
    shellDeactivation.set(ShellConstants.GITBASH, deactivate);

    shellActivation.set(ShellConstants.CMD, activate);
    shellDeactivation.set(ShellConstants.CMD, deactivate);

    shellActivation.set(ShellConstants.BASH, activate);
    shellDeactivation.set(ShellConstants.BASH, deactivate);

    shellActivation.set(ShellConstants.SH, activate);
    shellDeactivation.set(ShellConstants.SH, deactivate);

    shellActivation.set(ShellConstants.ZSH, activate);
    shellDeactivation.set(ShellConstants.ZSH, deactivate);

    shellActivation.set(ShellConstants.PWSH, activate);
    shellDeactivation.set(ShellConstants.PWSH, deactivate);

    return { shellActivation, shellDeactivation };
}

async function windowsExceptionGenerateConfig(
    sourceInitPath: string,
    prefix: string,
    condaFolder: string,
): Promise<ShellCommandMaps> {
    const shellActivation: Map<string, PythonCommandRunConfiguration[]> = new Map();
    const shellDeactivation: Map<string, PythonCommandRunConfiguration[]> = new Map();

    const ps1Hook = await getCondaHookPs1Path(condaFolder);
    traceVerbose(`PS1 hook path: ${ps1Hook ?? 'not found'}`);
    const activation = ps1Hook ? ps1Hook : sourceInitPath;

    const pwshActivate = [{ executable: activation }, { executable: 'conda', args: ['activate', prefix] }];
    const cmdActivate = [{ executable: sourceInitPath }, { executable: 'conda', args: ['activate', prefix] }];

    const bashActivate = [{ executable: 'source', args: [sourceInitPath.replace(/\\/g, '/'), prefix] }];
    traceVerbose(
        `Windows activation commands: 
        PowerShell: ${JSON.stringify(pwshActivate)}, 
        CMD: ${JSON.stringify(cmdActivate)},
        Bash: ${JSON.stringify(bashActivate)}`,
    );

    let condaCommonDeactivate: PythonCommandRunConfiguration | undefined = {
        executable: 'conda',
        args: ['deactivate'],
    };
    shellActivation.set(ShellConstants.GITBASH, bashActivate);
    shellDeactivation.set(ShellConstants.GITBASH, [condaCommonDeactivate]);

    shellActivation.set(ShellConstants.CMD, cmdActivate);
    shellDeactivation.set(ShellConstants.CMD, [condaCommonDeactivate]);

    shellActivation.set(ShellConstants.PWSH, pwshActivate);
    shellDeactivation.set(ShellConstants.PWSH, [condaCommonDeactivate]);

    return { shellActivation, shellDeactivation };
}

function getCondaWithoutPython(name: string, prefix: string, conda: string): PythonEnvironmentInfo {
    return {
        name: name,
        environmentPath: Uri.file(prefix),
        displayName: `${name} (no-python)`,
        shortDisplayName: `${name} (no-python)`,
        displayPath: prefix,
        description: prefix,
        tooltip: l10n.t('Conda environment without Python'),
        version: 'no-python',
        sysPrefix: prefix,
        iconPath: new ThemeIcon('stop'),
        execInfo: {
            run: { executable: conda },
        },
        group: name.length > 0 ? 'Named' : 'Prefix',
    };
}

async function nativeToPythonEnv(
    e: NativeEnvInfo,
    api: PythonEnvironmentApi,
    manager: EnvironmentManager,
    log: LogOutputChannel,
    conda: string,
    condaPrefixes: string[],
): Promise<PythonEnvironment | undefined> {
    if (!(e.prefix && e.executable && e.version)) {
        let name = e.name;
        const environment = api.createPythonEnvironmentItem(
            getCondaWithoutPython(name ?? '', e.prefix ?? '', conda),
            manager,
        );
        log.info(`Found a No-Python conda environment: ${e.executable ?? e.prefix ?? 'conda-no-python'}`);
        return environment;
    }

    if (e.name === 'base') {
        const environment = api.createPythonEnvironmentItem(
            await getNamedCondaPythonInfo('base', e.prefix, e.executable, e.version, conda, manager),
            manager,
        );
        log.info(`Found base environment: ${e.prefix}`);
        return environment;
    } else if (!isPrefixOf(condaPrefixes, e.prefix)) {
        const environment = api.createPythonEnvironmentItem(
            await getPrefixesCondaPythonInfo(e.prefix, e.executable, e.version, conda, manager),
            manager,
        );
        log.info(`Found prefix environment: ${e.prefix}`);
        return environment;
    } else {
        const basename = path.basename(e.prefix);
        const name = e.name ?? basename;
        const environment = api.createPythonEnvironmentItem(
            await getNamedCondaPythonInfo(name, e.prefix, e.executable, e.version, conda, manager),
            manager,
        );
        log.info(`Found named environment: ${e.prefix}`);
        return environment;
    }
}

export async function resolveCondaPath(
    fsPath: string,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
): Promise<PythonEnvironment | undefined> {
    try {
        const e = await nativeFinder.resolve(fsPath);
        if (e.kind !== NativePythonEnvironmentKind.conda) {
            return undefined;
        }
        const conda = await getConda();
        const condaPrefixes = await getPrefixes();
        return nativeToPythonEnv(e, api, manager, log, conda, condaPrefixes);
    } catch {
        return undefined;
    }
}

export async function refreshCondaEnvs(
    hardRefresh: boolean,
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
): Promise<PythonEnvironment[]> {
    log.info('Refreshing conda environments');
    const data = await nativeFinder.refresh(hardRefresh);

    let conda: string | undefined = undefined;
    try {
        conda = await getConda();
    } catch {
        conda = undefined;
    }
    if (conda === undefined) {
        const managers = data
            .filter((e) => !isNativeEnvInfo(e))
            .map((e) => e as NativeEnvManagerInfo)
            .filter((e) => e.tool.toLowerCase() === 'conda');
        conda = managers[0].executable;
        await setConda(conda);
    }

    const condaPath = conda;

    if (condaPath) {
        const condaPrefixes = await getPrefixes();
        const envs = data
            .filter((e) => isNativeEnvInfo(e))
            .map((e) => e as NativeEnvInfo)
            .filter((e) => e.kind === NativePythonEnvironmentKind.conda);
        const collection: PythonEnvironment[] = [];

        await Promise.all(
            envs.map(async (e) => {
                const environment = await nativeToPythonEnv(e, api, manager, log, condaPath, condaPrefixes);
                if (environment) {
                    collection.push(environment);
                }
            }),
        );

        return sortEnvironments(collection);
    }

    log.error('Conda not found');
    return [];
}

export function getName(api: PythonEnvironmentApi, uris?: Uri | Uri[]): string | undefined {
    if (!uris) {
        return undefined;
    }
    if (Array.isArray(uris) && uris.length !== 1) {
        return undefined;
    }
    return api.getPythonProject(Array.isArray(uris) ? uris[0] : uris)?.name;
}

export async function getLocation(api: PythonEnvironmentApi, uris: Uri | Uri[]): Promise<string | undefined> {
    if (!uris || (Array.isArray(uris) && (uris.length === 0 || uris.length > 1))) {
        const projects: PythonProject[] = [];
        if (Array.isArray(uris)) {
            for (let uri of uris) {
                const project = api.getPythonProject(uri);
                if (project && !projects.includes(project)) {
                    projects.push(project);
                }
            }
        } else {
            api.getPythonProjects().forEach((p) => projects.push(p));
        }
        const project = await pickProject(projects);
        return project?.uri.fsPath;
    }
    return api.getPythonProject(Array.isArray(uris) ? uris[0] : uris)?.uri.fsPath;
}
const RECOMMENDED_CONDA_PYTHON = '3.11.11';

export function trimVersionToMajorMinor(version: string): string {
    const match = version.match(/^(\d+\.\d+\.\d+)/);
    return match ? match[1] : version;
}
export async function pickPythonVersion(
    api: PythonEnvironmentApi,
    token?: CancellationToken,
): Promise<string | undefined> {
    const envs = await api.getEnvironments('global');
    let versions = Array.from(
        new Set(
            envs
                .map((env) => env.version)
                .filter(Boolean)
                .map((v) => trimVersionToMajorMinor(v)), // cut to 3 digits
        ),
    );

    // Sort versions by major version (descending), ignoring minor/patch for simplicity
    const parseMajorMinor = (v: string) => {
        const m = v.match(/^(\d+)(?:\.(\d+))?/);
        return { major: m ? Number(m[1]) : 0, minor: m && m[2] ? Number(m[2]) : 0 };
    };

    versions = versions.sort((a, b) => {
        const pa = parseMajorMinor(a);
        const pb = parseMajorMinor(b);
        if (pa.major !== pb.major) {
            return pb.major - pa.major;
        } // desc by major
        return pb.minor - pa.minor; // desc by minor
    });

    if (!versions || versions.length === 0) {
        versions = ['3.13', '3.12', '3.11', '3.10', '3.9'];
    }
    const items: QuickPickItem[] = versions.map((v) => ({
        label: v === RECOMMENDED_CONDA_PYTHON ? `$(star-full) Python` : 'Python',
        description: v,
    }));
    const selection = await showQuickPickWithButtons(
        items,
        {
            placeHolder: l10n.t('Select the version of Python to install in the environment'),
            matchOnDescription: true,
            ignoreFocusOut: true,
            showBackButton: true,
        },
        token,
    );

    if (selection) {
        return (selection as QuickPickItem).description;
    }

    return undefined;
}

export async function createCondaEnvironment(
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
    uris?: Uri | Uri[],
): Promise<PythonEnvironment | undefined> {
    return createStepBasedCondaFlow(api, log, manager, uris);
}

export async function createNamedCondaEnvironment(
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
    name?: string,
    pythonVersion?: string,
): Promise<PythonEnvironment | undefined> {
    try {
        name = await showInputBoxWithButtons({
            prompt: CondaStrings.condaNamedInput,
            value: name,
            ignoreFocusOut: true,
            showBackButton: true,
        });
        if (!name) {
            return;
        }
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // If back button was pressed, go back to the environment type selection
            return await createCondaEnvironment(api, log, manager);
        }
        throw ex;
    }

    const envName: string = name;
    const runArgs = ['create', '--yes', '--name', envName];
    if (pythonVersion) {
        runArgs.push(`python=${pythonVersion}`);
    } else {
        runArgs.push('python');
    }

    return await withProgress(
        {
            location: ProgressLocation.Notification,
            title: l10n.t('Creating conda environment: {0}', envName),
        },
        async () => {
            try {
                const bin = os.platform() === 'win32' ? 'python.exe' : 'python';
                const output = await runCondaExecutable(runArgs);
                log.info(output);

                const prefixes = await getPrefixes();
                let envPath = '';
                for (let prefix of prefixes) {
                    if (await fse.pathExists(path.join(prefix, envName))) {
                        envPath = path.join(prefix, envName);
                        break;
                    }
                }
                const version = await getVersion(envPath);

                const environment = api.createPythonEnvironmentItem(
                    await getNamedCondaPythonInfo(
                        envName,
                        envPath,
                        path.join(envPath, bin),
                        version,
                        await getConda(),
                        manager,
                    ),
                    manager,
                );
                return environment;
            } catch (e) {
                log.error('Failed to create conda environment', e);
                setImmediate(async () => {
                    await showErrorMessageWithLogs(CondaStrings.condaCreateFailed, log);
                });
            }
        },
    );
}

export async function createPrefixCondaEnvironment(
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
    fsPath?: string,
    pythonVersion?: string,
): Promise<PythonEnvironment | undefined> {
    try {
        if (!fsPath) {
            return;
        }

        let name = `./.conda`;
        if (await fse.pathExists(path.join(fsPath, '.conda'))) {
            log.warn(`Environment "${path.join(fsPath, '.conda')}" already exists`);
            const newName = await showInputBoxWithButtons({
                prompt: l10n.t('Environment "{0}" already exists. Enter a different name', name),
                ignoreFocusOut: true,
                showBackButton: true,
                validateInput: (value) => {
                    if (value === name) {
                        return CondaStrings.condaExists;
                    }
                    return undefined;
                },
            });
            if (!newName) {
                return;
            }
            name = newName;
        }

        const prefix: string = path.isAbsolute(name) ? name : path.join(fsPath, name);

        const runArgs = ['create', '--yes', '--prefix', prefix];
        if (pythonVersion) {
            runArgs.push(`python=${pythonVersion}`);
        } else {
            runArgs.push('python');
        }

        return await withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Creating conda environment: ${name}`,
            },
            async () => {
                try {
                    const bin = os.platform() === 'win32' ? 'python.exe' : 'python';
                    const output = await runCondaExecutable(runArgs);
                    log.info(output);
                    const version = await getVersion(prefix);

                    const environment = api.createPythonEnvironmentItem(
                        await getPrefixesCondaPythonInfo(
                            prefix,
                            path.join(prefix, bin),
                            version,
                            await getConda(),
                            manager,
                        ),
                        manager,
                    );
                    return environment;
                } catch (e) {
                    log.error('Failed to create conda environment', e);
                    setImmediate(async () => {
                        await showErrorMessageWithLogs(CondaStrings.condaCreateFailed, log);
                    });
                }
            },
        );
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // If back button was pressed, go back to the environment type selection
            return await createCondaEnvironment(api, log, manager);
        }
        throw ex;
    }
}

export async function generateName(fsPath: string): Promise<string | undefined> {
    let attempts = 0;
    while (attempts < 5) {
        const randomStr = Math.random().toString(36).substring(2);
        const name = `env_${randomStr}`;
        const prefix = path.join(fsPath, name);
        if (!(await fse.exists(prefix))) {
            return name;
        }
    }
    return undefined;
}

export async function quickCreateConda(
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
    fsPath: string,
    name: string,
    additionalPackages?: string[],
): Promise<PythonEnvironment | undefined> {
    const prefix = path.join(fsPath, name);
    const execPath = os.platform() === 'win32' ? path.join(prefix, 'python.exe') : path.join(prefix, 'bin', 'python');

    return await withProgress(
        {
            location: ProgressLocation.Notification,
            title: `Creating conda environment: ${name}`,
        },
        async () => {
            try {
                await runCondaExecutable(['create', '--yes', '--prefix', prefix, 'python'], log);
                if (additionalPackages && additionalPackages.length > 0) {
                    await runConda(['install', '--yes', '--prefix', prefix, ...additionalPackages], log);
                }
                const version = await getVersion(prefix);

                const environment = api.createPythonEnvironmentItem(
                    {
                        name: path.basename(prefix),
                        environmentPath: Uri.file(prefix),
                        displayName: `${version} (${name})`,
                        displayPath: prefix,
                        description: prefix,
                        version,
                        execInfo: {
                            run: { executable: execPath },
                            activatedRun: {
                                executable: execPath,
                                args: [],
                            },
                            activation: [{ executable: 'conda', args: ['activate', prefix] }],
                            deactivation: [{ executable: 'conda', args: ['deactivate'] }],
                        },
                        sysPrefix: prefix,
                        group: 'Prefix',
                    },
                    manager,
                );
                return environment;
            } catch (e) {
                log.error('Failed to create conda environment', e);
                setImmediate(async () => {
                    await showErrorMessageWithLogs(CondaStrings.condaCreateFailed, log);
                });
            }
        },
    );
}

export async function deleteCondaEnvironment(environment: PythonEnvironment, log: LogOutputChannel): Promise<boolean> {
    let args = ['env', 'remove', '--yes', '--prefix', environment.environmentPath.fsPath];
    return await withProgress(
        {
            location: ProgressLocation.Notification,
            title: l10n.t('Deleting conda environment: {0}', environment.environmentPath.fsPath),
        },
        async () => {
            try {
                await runCondaExecutable(args, log);
            } catch (e) {
                log.error(`Failed to delete conda environment: ${e}`);
                setImmediate(async () => {
                    await showErrorMessageWithLogs(CondaStrings.condaRemoveFailed, log);
                });
                return false;
            }
            return true;
        },
    );
}

export async function refreshPackages(
    environment: PythonEnvironment,
    api: PythonEnvironmentApi,
    manager: PackageManager,
): Promise<Package[]> {
    let args = ['list', '-p', environment.environmentPath.fsPath];
    const data = await runCondaExecutable(args);
    const content = data.split(/\r?\n/).filter((l) => !l.startsWith('#'));
    const packages: Package[] = [];
    content.forEach((l) => {
        const parts = l.split(' ').filter((p) => p.length > 0);
        if (parts.length >= 3) {
            const pkg = api.createPackageItem(
                {
                    name: parts[0],
                    displayName: parts[0],
                    version: parts[1],
                    description: parts[1],
                },
                environment,
                manager,
            );
            packages.push(pkg);
        }
    });
    return packages;
}

export async function managePackages(
    environment: PythonEnvironment,
    options: PackageManagementOptions,
    api: PythonEnvironmentApi,
    manager: PackageManager,
    token: CancellationToken,
    log: LogOutputChannel,
): Promise<Package[]> {
    if (options.uninstall && options.uninstall.length > 0) {
        await runCondaExecutable(
            ['remove', '--prefix', environment.environmentPath.fsPath, '--yes', ...options.uninstall],
            log,
            token,
        );
    }
    if (options.install && options.install.length > 0) {
        const args = ['install', '--prefix', environment.environmentPath.fsPath, '--yes'];
        if (options.upgrade) {
            args.push('--update-all');
        }
        args.push(...options.install);
        await runCondaExecutable(args, log, token);
    }
    return refreshPackages(environment, api, manager);
}

async function getCommonPackages(): Promise<Installable[]> {
    try {
        const pipData = path.join(EXTENSION_ROOT_DIR, 'files', 'conda_packages.json');
        const data = await fse.readFile(pipData, { encoding: 'utf-8' });
        const packages = JSON.parse(data) as { name: string; description: string; uri: string }[];

        return packages.map((p) => {
            return {
                name: p.name,
                displayName: p.name,
                uri: Uri.parse(p.uri),
                description: p.description,
            };
        });
    } catch {
        return [];
    }
}

interface CondaPackagesResult {
    install: string[];
    uninstall: string[];
}

async function selectCommonPackagesOrSkip(
    common: Installable[],
    installed: string[],
    showSkipOption: boolean,
): Promise<CondaPackagesResult | undefined> {
    if (common.length === 0) {
        return undefined;
    }

    const items: QuickPickItem[] = [];
    if (common.length > 0) {
        items.push({
            label: PackageManagement.searchCommonPackages,
            description: PackageManagement.searchCommonPackagesDescription,
        });
    }

    if (showSkipOption && items.length > 0) {
        items.push({ label: PackageManagement.skipPackageInstallation });
    }

    let showBackButton = true;
    let selected: QuickPickItem[] | QuickPickItem | undefined = undefined;
    if (items.length === 1) {
        selected = items[0];
        showBackButton = false;
    } else {
        selected = await showQuickPickWithButtons(items, {
            placeHolder: Pickers.Packages.selectOption,
            ignoreFocusOut: true,
            showBackButton: true,
            matchOnDescription: false,
            matchOnDetail: false,
        });
    }

    if (selected && !Array.isArray(selected)) {
        try {
            if (selected.label === PackageManagement.searchCommonPackages) {
                return await selectFromCommonPackagesToInstall(common, installed, undefined, { showBackButton });
            } else {
                traceInfo('Package Installer: user selected skip package installation');
                return undefined;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (ex: any) {
            if (ex === QuickInputButtons.Back) {
                return selectCommonPackagesOrSkip(common, installed, showSkipOption);
            }
        }
    }
    return undefined;
}

export async function getCommonCondaPackagesToInstall(
    environment: PythonEnvironment,
    options: PackageManagementOptions,
    api: PythonEnvironmentApi,
): Promise<CondaPackagesResult | undefined> {
    const common = await getCommonPackages();
    const installed = (await api.getPackages(environment))?.map((p) => p.name);
    const selected = await selectCommonPackagesOrSkip(common, installed ?? [], !!options.showSkipOption);
    return selected;
}

async function installPython(
    nativeFinder: NativePythonFinder,
    manager: EnvironmentManager,
    environment: PythonEnvironment,
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
): Promise<PythonEnvironment | undefined> {
    if (environment.sysPrefix === '') {
        return undefined;
    }
    await runCondaExecutable(['install', '--yes', '--prefix', environment.sysPrefix, 'python'], log);
    await nativeFinder.refresh(true, NativePythonEnvironmentKind.conda);
    const native = await nativeFinder.resolve(environment.sysPrefix);
    if (native.kind === NativePythonEnvironmentKind.conda) {
        return nativeToPythonEnv(native, api, manager, log, await getConda(), await getPrefixes());
    }
    return undefined;
}

export async function checkForNoPythonCondaEnvironment(
    nativeFinder: NativePythonFinder,
    manager: EnvironmentManager,
    environment: PythonEnvironment,
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
): Promise<PythonEnvironment | undefined> {
    if (environment.version === 'no-python') {
        if (environment.sysPrefix === '') {
            await showErrorMessage(CondaStrings.condaMissingPythonNoFix, { modal: true });
            return undefined;
        } else {
            const result = await showErrorMessage(
                `${CondaStrings.condaMissingPython}: ${environment.displayName}`,
                {
                    modal: true,
                },
                Common.installPython,
            );
            if (result === Common.installPython) {
                return await installPython(nativeFinder, manager, environment, api, log);
            }
            return undefined;
        }
    }
    return environment;
}
