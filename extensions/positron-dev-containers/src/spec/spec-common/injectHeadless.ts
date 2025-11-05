/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
import * as crypto from 'crypto';

import { ContainerError, toErrorText, toWarningText } from './errors';
import { launch, ShellServer } from './shellServer';
import { ExecFunction, CLIHost, PtyExecFunction, isFile, Exec, PtyExec, getEntPasswdShellCommand } from './commonUtils';
import { Disposable, Event, NodeEventEmitter } from '../spec-utils/event';
import { PackageConfiguration } from '../spec-utils/product';
import { URI } from 'vscode-uri';
import { containerSubstitute } from './variableSubstitution';
import { delay } from './async';
import { Log, LogEvent, LogLevel, makeLog, nullLog } from '../spec-utils/log';
import { buildProcessTrees, findProcesses, Process, processTreeToString } from './proc';
import { installDotfiles } from './dotfiles';

export enum ResolverProgress {
	Begin,
	CloningRepository,
	BuildingImage,
	StartingContainer,
	InstallingServer,
	StartingServer,
	End,
}

export interface ResolverParameters {
	prebuild?: boolean;
	computeExtensionHostEnv: boolean;
	package: PackageConfiguration;
	containerDataFolder: string | undefined;
	containerSystemDataFolder: string | undefined;
	appRoot: string | undefined;
	extensionPath: string;
	sessionId: string;
	sessionStart: Date;
	cliHost: CLIHost;
	env: NodeJS.ProcessEnv;
	cwd: string;
	isLocalContainer: boolean;
	dotfilesConfiguration: DotfilesConfiguration;
	progress: (current: ResolverProgress) => void;
	output: Log;
	allowSystemConfigChange: boolean;
	defaultUserEnvProbe: UserEnvProbe;
	lifecycleHook: LifecycleHook;
	getLogLevel: () => LogLevel;
	onDidChangeLogLevel: Event<LogLevel>;
	loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>;
	allowInheritTTY: boolean;
	shutdowns: (() => Promise<void>)[];
	backgroundTasks: (Promise<void> | (() => Promise<void>))[];
	persistedFolder: string; // A path where config can be persisted and restored at a later time. Should default to tmpdir() folder if not provided.
	remoteEnv: Record<string, string>;
	buildxPlatform: string | undefined;
	buildxPush: boolean;
	buildxOutput: string | undefined;
	buildxCacheTo: string | undefined;
	skipFeatureAutoMapping: boolean;
	skipPostAttach: boolean;
	containerSessionDataFolder?: string;
	skipPersistingCustomizationsFromFeatures: boolean;
	omitConfigRemotEnvFromMetadata?: boolean;
	secretsP?: Promise<Record<string, string>>;
	omitSyntaxDirective?: boolean;
}

export interface LifecycleHook {
	enabled: boolean;
	skipNonBlocking: boolean;
	output: Log;
	onDidInput: Event<string>;
	done: () => void;
}

export type LifecycleHooksInstallMap = {
	[lifecycleHook in DevContainerLifecycleHook]: {
		command: LifecycleCommand;
		origin: string;
	}[]; // In installation order.
};

export function createNullLifecycleHook(enabled: boolean, skipNonBlocking: boolean, output: Log): LifecycleHook {
	function listener(data: Buffer) {
		emitter.fire(data.toString());
	}
	const emitter = new NodeEventEmitter<string>({
		on: () => {
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(true);
			}
			process.stdin.on('data', listener);
		},
		off: () => process.stdin.off('data', listener),
	});
	return {
		enabled,
		skipNonBlocking,
		output: makeLog({
			...output,
			get dimensions() {
				return output.dimensions;
			},
			event: e => output.event({
				...e,
				channel: 'postCreate',
			}),
		}),
		onDidInput: emitter.event,
		done: () => { },
	};
}

export interface PortAttributes {
	label: string | undefined;
	onAutoForward: string | undefined;
	elevateIfNeeded: boolean | undefined;
}

export type UserEnvProbe = 'none' | 'loginInteractiveShell' | 'interactiveShell' | 'loginShell';

export type DevContainerLifecycleHook = 'initializeCommand' | 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand' | 'postStartCommand' | 'postAttachCommand';

const defaultWaitFor: DevContainerLifecycleHook = 'updateContentCommand';

export type LifecycleCommand = string | string[] | { [key: string]: string | string[] };

export interface CommonDevContainerConfig {
	configFilePath?: URI;
	remoteEnv?: Record<string, string | null>;
	forwardPorts?: (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	onCreateCommand?: LifecycleCommand | Record<string, LifecycleCommand>;
	updateContentCommand?: LifecycleCommand | Record<string, LifecycleCommand>;
	postCreateCommand?: LifecycleCommand | Record<string, LifecycleCommand>;
	postStartCommand?: LifecycleCommand | Record<string, LifecycleCommand>;
	postAttachCommand?: LifecycleCommand | Record<string, LifecycleCommand>;
	waitFor?: DevContainerLifecycleHook;
	userEnvProbe?: UserEnvProbe;
}

export interface CommonContainerMetadata {
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerLifecycleHook;
	remoteEnv?: Record<string, string | null>;
	userEnvProbe?: UserEnvProbe;
}

export type CommonMergedDevContainerConfig = MergedConfig<CommonDevContainerConfig>;

type MergedConfig<T extends CommonDevContainerConfig> = Omit<T, typeof replaceProperties[number]> & UpdatedConfigProperties;

const replaceProperties = [
	'onCreateCommand',
	'updateContentCommand',
	'postCreateCommand',
	'postStartCommand',
	'postAttachCommand',
] as const;

interface UpdatedConfigProperties {
	onCreateCommands?: LifecycleCommand[];
	updateContentCommands?: LifecycleCommand[];
	postCreateCommands?: LifecycleCommand[];
	postStartCommands?: LifecycleCommand[];
	postAttachCommands?: LifecycleCommand[];
}

export interface OSRelease {
	hardware: string;
	id: string;
	version: string;
}

export interface ContainerProperties {
	createdAt: string | undefined;
	startedAt: string | undefined;
	osRelease: OSRelease;
	user: string;
	gid: string | undefined;
	env: NodeJS.ProcessEnv;
	shell: string;
	homeFolder: string;
	userDataFolder: string;
	remoteWorkspaceFolder?: string;
	remoteExec: ExecFunction;
	remotePtyExec: PtyExecFunction;
	remoteExecAsRoot?: ExecFunction;
	shellServer: ShellServer;
	launchRootShellServer?: () => Promise<ShellServer>;
}

export interface DotfilesConfiguration {
	repository: string | undefined;
	installCommand: string | undefined;
	targetPath: string;
}

export async function getContainerProperties(options: {
	params: ResolverParameters;
	createdAt: string | undefined;
	startedAt: string | undefined;
	remoteWorkspaceFolder: string | undefined;
	containerUser: string | undefined;
	containerGroup: string | undefined;
	containerEnv: NodeJS.ProcessEnv | undefined;
	remoteExec: ExecFunction;
	remotePtyExec: PtyExecFunction;
	remoteExecAsRoot: ExecFunction | undefined;
	rootShellServer: ShellServer | undefined;
}) {
	let { params, createdAt, startedAt, remoteWorkspaceFolder, containerUser, containerGroup, containerEnv, remoteExec, remotePtyExec, remoteExecAsRoot, rootShellServer } = options;
	let shellServer: ShellServer;
	if (rootShellServer && containerUser === 'root') {
		shellServer = rootShellServer;
	} else {
		shellServer = await launch(remoteExec, params.output, params.sessionId);
	}
	if (!containerEnv) {
		const PATH = (await shellServer.exec('echo $PATH')).stdout.trim();
		containerEnv = PATH ? { PATH } : {};
	}
	if (!containerUser) {
		containerUser = await getUser(shellServer);
	}
	if (!remoteExecAsRoot && containerUser === 'root') {
		remoteExecAsRoot = remoteExec;
	}
	const osRelease = await getOSRelease(shellServer);
	const passwdUser = await getUserFromPasswdDB(shellServer, containerUser);
	if (!passwdUser) {
		params.output.write(toWarningText(`User ${containerUser} not found with 'getent passwd'.`));
	}
	const shell = await getUserShell(containerEnv, passwdUser);
	const homeFolder = await getHomeFolder(shellServer, containerEnv, passwdUser);
	const userDataFolder = getUserDataFolder(homeFolder, params);
	let rootShellServerP: Promise<ShellServer> | undefined;
	if (rootShellServer) {
		rootShellServerP = Promise.resolve(rootShellServer);
	} else if (containerUser === 'root') {
		rootShellServerP = Promise.resolve(shellServer);
	}
	const containerProperties: ContainerProperties = {
		createdAt,
		startedAt,
		osRelease,
		user: containerUser,
		gid: containerGroup || passwdUser?.gid,
		env: containerEnv,
		shell,
		homeFolder,
		userDataFolder,
		remoteWorkspaceFolder,
		remoteExec,
		remotePtyExec,
		remoteExecAsRoot,
		shellServer,
	};
	if (rootShellServerP || remoteExecAsRoot) {
		containerProperties.launchRootShellServer = () => rootShellServerP || (rootShellServerP = launch(remoteExecAsRoot!, params.output));
	}
	return containerProperties;
}

export async function getUser(shellServer: ShellServer) {
	return (await shellServer.exec('id -un')).stdout.trim();
}

export async function getHomeFolder(shellServer: ShellServer, containerEnv: NodeJS.ProcessEnv, passwdUser: PasswdUser | undefined) {
	if (containerEnv.HOME) {
		if (containerEnv.HOME === passwdUser?.home || passwdUser?.uid === '0') {
			return containerEnv.HOME;
		}
		try {
			await shellServer.exec(`[ ! -e '${containerEnv.HOME}' ] || [ -w '${containerEnv.HOME}' ]`);
			return containerEnv.HOME;
		} catch {
			// Exists but not writable.
		}
	}
	return passwdUser?.home || '/root';
}

async function getUserShell(containerEnv: NodeJS.ProcessEnv, passwdUser: PasswdUser | undefined) {
	return containerEnv.SHELL || (passwdUser && passwdUser.shell) || '/bin/sh';
}

export async function getUserFromPasswdDB(shellServer: ShellServer, userNameOrId: string) {
	const { stdout } = await shellServer.exec(getEntPasswdShellCommand(userNameOrId), { logOutput: false });
	if (!stdout.trim()) {
		return undefined;
	}
	return parseUserInPasswdDB(stdout);
}

export interface PasswdUser {
	name: string;
	uid: string;
	gid: string;
	home: string;
	shell: string;
}

function parseUserInPasswdDB(etcPasswdLine: string): PasswdUser | undefined {
	const row = etcPasswdLine
		.replace(/\n$/, '')
		.split(':');
	return {
		name: row[0],
		uid: row[2],
		gid: row[3],
		home: row[5],
		shell: row[6]
	};
}

export function getUserDataFolder(homeFolder: string, params: ResolverParameters) {
	return path.posix.resolve(homeFolder, params.containerDataFolder || '.devcontainer');
}

export function getSystemVarFolder(params: ResolverParameters): string {
	return params.containerSystemDataFolder || '/var/devcontainer';
}

export async function setupInContainer(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonDevContainerConfig, mergedConfig: CommonMergedDevContainerConfig, lifecycleCommandOriginMap: LifecycleHooksInstallMap) {
	await patchEtcEnvironment(params, containerProperties);
	await patchEtcProfile(params, containerProperties);
	const computeRemoteEnv = params.computeExtensionHostEnv || params.lifecycleHook.enabled;
	const updatedConfig = containerSubstitute(params.cliHost.platform, config.configFilePath, containerProperties.env, config);
	const updatedMergedConfig = containerSubstitute(params.cliHost.platform, mergedConfig.configFilePath, containerProperties.env, mergedConfig);
	const remoteEnv = computeRemoteEnv ? probeRemoteEnv(params, containerProperties, updatedMergedConfig) : Promise.resolve({});
	const secretsP = params.secretsP || Promise.resolve({});
	if (params.lifecycleHook.enabled) {
		await runLifecycleHooks(params, lifecycleCommandOriginMap, containerProperties, updatedMergedConfig, remoteEnv, secretsP, false);
	}
	return {
		remoteEnv: params.computeExtensionHostEnv ? await remoteEnv : {},
		updatedConfig,
		updatedMergedConfig,
	};
}

export function probeRemoteEnv(params: ResolverParameters, containerProperties: ContainerProperties, config: CommonMergedDevContainerConfig) {
	return probeUserEnv(params, containerProperties, config)
		.then<Record<string, string>>(shellEnv => ({
			...shellEnv,
			...params.remoteEnv,
			...config.remoteEnv,
		} as Record<string, string>));
}

export async function runLifecycleHooks(params: ResolverParameters, lifecycleHooksInstallMap: LifecycleHooksInstallMap, containerProperties: ContainerProperties, config: CommonMergedDevContainerConfig, remoteEnv: Promise<Record<string, string>>, secrets: Promise<Record<string, string>>, stopForPersonalization: boolean): Promise<'skipNonBlocking' | 'prebuild' | 'stopForPersonalization' | 'done'> {
	const skipNonBlocking = params.lifecycleHook.skipNonBlocking;
	const waitFor = config.waitFor || defaultWaitFor;
	if (skipNonBlocking && waitFor === 'initializeCommand') {
		return 'skipNonBlocking';
	}

	params.output.write('LifecycleCommandExecutionMap: ' + JSON.stringify(lifecycleHooksInstallMap, undefined, 4), LogLevel.Trace);

	await runPostCreateCommand(params, lifecycleHooksInstallMap, containerProperties, 'onCreateCommand', remoteEnv, secrets, false);
	if (skipNonBlocking && waitFor === 'onCreateCommand') {
		return 'skipNonBlocking';
	}

	await runPostCreateCommand(params, lifecycleHooksInstallMap, containerProperties, 'updateContentCommand', remoteEnv, secrets, !!params.prebuild);
	if (skipNonBlocking && waitFor === 'updateContentCommand') {
		return 'skipNonBlocking';
	}

	if (params.prebuild) {
		return 'prebuild';
	}

	await runPostCreateCommand(params, lifecycleHooksInstallMap, containerProperties, 'postCreateCommand', remoteEnv, secrets, false);
	if (skipNonBlocking && waitFor === 'postCreateCommand') {
		return 'skipNonBlocking';
	}

	if (params.dotfilesConfiguration) {
		await installDotfiles(params, containerProperties, remoteEnv, secrets);
	}

	if (stopForPersonalization) {
		return 'stopForPersonalization';
	}

	await runPostStartCommand(params, lifecycleHooksInstallMap, containerProperties, remoteEnv, secrets);
	if (skipNonBlocking && waitFor === 'postStartCommand') {
		return 'skipNonBlocking';
	}

	if (!params.skipPostAttach) {
		await runPostAttachCommand(params, lifecycleHooksInstallMap, containerProperties, remoteEnv, secrets);
	}
	return 'done';
}

export async function getOSRelease(shellServer: ShellServer) {
	let hardware = 'unknown';
	let id = 'unknown';
	let version = 'unknown';
	try {
		hardware = (await shellServer.exec('uname -m')).stdout.trim();
		const { stdout } = await shellServer.exec('(cat /etc/os-release || cat /usr/lib/os-release) 2>/dev/null');
		id = (stdout.match(/^ID=([^\u001b\r\n]*)/m) || [])[1] || 'notfound';
		version = (stdout.match(/^VERSION_ID=([^\u001b\r\n]*)/m) || [])[1] || 'notfound';
	} catch (err) {
		console.error(err);
		// Optimistically continue.
	}
	return { hardware, id, version };
}

async function runPostCreateCommand(params: ResolverParameters, lifecycleCommandOriginMap: LifecycleHooksInstallMap, containerProperties: ContainerProperties, postCommandName: 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand', remoteEnv: Promise<Record<string, string>>, secrets: Promise<Record<string, string>>, rerun: boolean) {
	const markerFile = path.posix.join(containerProperties.userDataFolder, `.${postCommandName}Marker`);
	const doRun = !!containerProperties.createdAt && await updateMarkerFile(containerProperties.shellServer, markerFile, containerProperties.createdAt) || rerun;
	await runLifecycleCommands(params, lifecycleCommandOriginMap, containerProperties, postCommandName, remoteEnv, secrets, doRun);
}

async function runPostStartCommand(params: ResolverParameters, lifecycleCommandOriginMap: LifecycleHooksInstallMap, containerProperties: ContainerProperties, remoteEnv: Promise<Record<string, string>>, secrets: Promise<Record<string, string>>) {
	const markerFile = path.posix.join(containerProperties.userDataFolder, '.postStartCommandMarker');
	const doRun = !!containerProperties.startedAt && await updateMarkerFile(containerProperties.shellServer, markerFile, containerProperties.startedAt);
	await runLifecycleCommands(params, lifecycleCommandOriginMap, containerProperties, 'postStartCommand', remoteEnv, secrets, doRun);
}

async function updateMarkerFile(shellServer: ShellServer, location: string, content: string) {
	try {
		await shellServer.exec(`mkdir -p '${path.posix.dirname(location)}' && CONTENT="$(cat '${location}' 2>/dev/null || echo ENOENT)" && [ "\${CONTENT:-${content}}" != '${content}' ] && echo '${content}' > '${location}'`);
		return true;
	} catch (err) {
		return false;
	}
}

async function runPostAttachCommand(params: ResolverParameters, lifecycleCommandOriginMap: LifecycleHooksInstallMap, containerProperties: ContainerProperties, remoteEnv: Promise<Record<string, string>>, secrets: Promise<Record<string, string>>) {
	await runLifecycleCommands(params, lifecycleCommandOriginMap, containerProperties, 'postAttachCommand', remoteEnv, secrets, true);
}


async function runLifecycleCommands(params: ResolverParameters, lifecycleCommandOriginMap: LifecycleHooksInstallMap, containerProperties: ContainerProperties, lifecycleHookName: 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand' | 'postStartCommand' | 'postAttachCommand', remoteEnv: Promise<Record<string, string>>, secrets: Promise<Record<string, string>>, doRun: boolean) {
	const commandsForHook = lifecycleCommandOriginMap[lifecycleHookName];
	if (commandsForHook.length === 0) {
		return;
	}

	for (const { command, origin } of commandsForHook) {
		const displayOrigin = origin ? (origin === 'devcontainer.json' ? origin : `Feature '${origin}'`) : '???'; /// '???' should never happen.
		await runLifecycleCommand(params, containerProperties, command, displayOrigin, lifecycleHookName, remoteEnv, secrets, doRun);
	}
}

async function runLifecycleCommand({ lifecycleHook }: ResolverParameters, containerProperties: ContainerProperties, userCommand: LifecycleCommand, userCommandOrigin: string, lifecycleHookName: 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand' | 'postStartCommand' | 'postAttachCommand', remoteEnv: Promise<Record<string, string>>, secrets: Promise<Record<string, string>>, doRun: boolean) {
	let hasCommand = false;
	if (typeof userCommand === 'string') {
		hasCommand = userCommand.trim().length > 0;
	} else if (Array.isArray(userCommand)) {
		hasCommand = userCommand.length > 0;
	} else if (typeof userCommand === 'object') {
		hasCommand = Object.keys(userCommand).length > 0;
	}
	if (doRun && userCommand && hasCommand) {
		const progressName = `Running ${lifecycleHookName}...`;
		const infoOutput = makeLog({
			event(e: LogEvent) {
				lifecycleHook.output.event(e);
				if (e.type === 'raw' && e.text.includes('::endstep::')) {
					lifecycleHook.output.event({
						type: 'progress',
						name: progressName,
						status: 'running',
						stepDetail: ''
					});
				}
				if (e.type === 'raw' && e.text.includes('::step::')) {
					lifecycleHook.output.event({
						type: 'progress',
						name: progressName,
						status: 'running',
						stepDetail: `${e.text.split('::step::')[1].split('\r\n')[0]}`
					});
				}
			},
			get dimensions() {
				return lifecycleHook.output.dimensions;
			},
			onDidChangeDimensions: lifecycleHook.output.onDidChangeDimensions,
		}, LogLevel.Info);
		const remoteCwd = containerProperties.remoteWorkspaceFolder || containerProperties.homeFolder;
		async function runSingleCommand(postCommand: string | string[], name?: string) {
			const progressDetails = typeof postCommand === 'string' ? postCommand : postCommand.join(' ');
			infoOutput.event({
				type: 'progress',
				name: progressName,
				status: 'running',
				stepDetail: progressDetails
			});
			// If we have a command name then the command is running in parallel and 
			// we need to hold output until the command is done so that the output
			// doesn't get interleaved with the output of other commands.
			const printMode = name ? 'off' : 'continuous';
			const env = { ...(await remoteEnv), ...(await secrets) };
			try {
				const { cmdOutput } = await runRemoteCommand({ ...lifecycleHook, output: infoOutput }, containerProperties, typeof postCommand === 'string' ? ['/bin/sh', '-c', postCommand] : postCommand, remoteCwd, { remoteEnv: env, pty: true, print: printMode });

				// 'name' is set when parallel execution syntax is used.
				if (name) {
					infoOutput.raw(`\x1b[1mRunning ${name} of ${lifecycleHookName} from ${userCommandOrigin}...\x1b[0m\r\n${cmdOutput}\r\n`);
				}
			} catch (err) {
				if (printMode === 'off' && err?.cmdOutput) {
					infoOutput.raw(`\r\n\x1b[1m${err.cmdOutput}\x1b[0m\r\n\r\n`);
				}
				if (err && (err.code === 130 || err.signal === 2)) { // SIGINT seen on darwin as code === 130, would also make sense as signal === 2.
					infoOutput.raw(`\r\n\x1b[1m${name ? `${name} of ${lifecycleHookName}` : lifecycleHookName} from ${userCommandOrigin} interrupted.\x1b[0m\r\n\r\n`);
				} else {
					if (err?.code) {
						infoOutput.write(toErrorText(`${name ? `${name} of ${lifecycleHookName}` : lifecycleHookName} from ${userCommandOrigin} failed with exit code ${err.code}. Skipping any further user-provided commands.`));
					}
					throw new ContainerError({
						description: `${name ? `${name} of ${lifecycleHookName}` : lifecycleHookName} from ${userCommandOrigin} failed.`,
						originalError: err
					});
				}
			}
		}

		infoOutput.raw(`\x1b[1mRunning the ${lifecycleHookName} from ${userCommandOrigin}...\x1b[0m\r\n\r\n`);

		try {
			let commands;
			if (typeof userCommand === 'string' || Array.isArray(userCommand)) {
				commands = [runSingleCommand(userCommand)];
			} else {
				commands = Object.keys(userCommand).map(name => {
					const command = userCommand[name];
					return runSingleCommand(command, name);
				});
			}

			const results = await Promise.allSettled(commands); // Wait for all commands to finish (successfully or not) before continuing.
			const rejection = results.find(p => p.status === 'rejected');
			if (rejection) {
				throw (rejection as PromiseRejectedResult).reason;
			}
			infoOutput.event({
				type: 'progress',
				name: progressName,
				status: 'succeeded',
			});
		} catch (err) {
			infoOutput.event({
				type: 'progress',
				name: progressName,
				status: 'failed',
			});
			throw err;
		}
	}
}

async function createFile(shellServer: ShellServer, location: string) {
	try {
		await shellServer.exec(createFileCommand(location));
		return true;
	} catch (err) {
		return false;
	}
}

export function createFileCommand(location: string) {
	return `test ! -f '${location}' && set -o noclobber && mkdir -p '${path.posix.dirname(location)}' && { > '${location}' ; } 2> /dev/null`;
}

export async function runRemoteCommand(params: { output: Log; onDidInput?: Event<string>; stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream }, { remoteExec, remotePtyExec }: ContainerProperties, cmd: string[], cwd?: string, options: { remoteEnv?: NodeJS.ProcessEnv; pty?: boolean; print?: 'off' | 'continuous' | 'end' } = {}) {
	const print = options.print || 'end';
	let sub: Disposable | undefined;
	let pp: Exec | PtyExec;
	let cmdOutput = '';
	if (options.pty) {
		const p = pp = await remotePtyExec({
			env: options.remoteEnv,
			cwd,
			cmd: cmd[0],
			args: cmd.slice(1),
			output: params.output,
		});
		p.onData(chunk => {
			cmdOutput += chunk;
			if (print === 'continuous') {
				if (params.stdout) {
					params.stdout.write(chunk);
				} else {
					params.output.raw(chunk);
				}
			}
		});
		if (p.write && params.onDidInput) {
			params.onDidInput(data => p.write!(data));
		} else if (p.write && params.stdin) {
			const listener = (data: Buffer): void => p.write!(data.toString());
			const stdin = params.stdin;
			if (stdin.isTTY) {
				stdin.setRawMode(true);
			}
			stdin.on('data', listener);
			sub = { dispose: () => stdin.off('data', listener) };
		}
	} else {
		const p = pp = await remoteExec({
			env: options.remoteEnv,
			cwd,
			cmd: cmd[0],
			args: cmd.slice(1),
			output: params.output,
		});
		const stdout: Buffer[] = [];
		if (print === 'continuous' && params.stdout) {
			p.stdout.pipe(params.stdout);
		} else {
			p.stdout.on('data', chunk => {
				stdout.push(chunk);
				if (print === 'continuous') {
					params.output.raw(chunk.toString());
				}
			});
		}
		const stderr: Buffer[] = [];
		if (print === 'continuous' && params.stderr) {
			p.stderr.pipe(params.stderr);
		} else {
			p.stderr.on('data', chunk => {
				stderr.push(chunk);
				if (print === 'continuous') {
					params.output.raw(chunk.toString());
				}
			});
		}
		if (params.onDidInput) {
			params.onDidInput(data => p.stdin.write(data));
		} else if (params.stdin) {
			params.stdin.pipe(p.stdin);
		}
		await pp.exit;
		cmdOutput = `${Buffer.concat(stdout)}\n${Buffer.concat(stderr)}`;
	}
	const exit = await pp.exit;
	if (sub) {
		sub.dispose();
	}
	if (print === 'end') {
		params.output.raw(cmdOutput);
	}
	if (exit.code || exit.signal) {
		return Promise.reject({
			message: `Command failed: ${cmd.join(' ')}`,
			cmdOutput,
			code: exit.code,
			signal: exit.signal,
		});
	}
	return {
		cmdOutput,
	};
}

async function runRemoteCommandNoPty(params: { output: Log }, { remoteExec }: { remoteExec: ExecFunction }, cmd: string[], cwd?: string, options: { remoteEnv?: NodeJS.ProcessEnv; stdin?: Buffer | fs.ReadStream; silent?: boolean; print?: 'off' | 'continuous' | 'end'; resolveOn?: RegExp } = {}) {
	const print = options.print || (options.silent ? 'off' : 'end');
	const p = await remoteExec({
		env: options.remoteEnv,
		cwd,
		cmd: cmd[0],
		args: cmd.slice(1),
		output: options.silent ? nullLog : params.output,
	});
	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	const stdoutDecoder = new StringDecoder();
	const stderrDecoder = new StringDecoder();
	let stdoutStr = '';
	let stderrStr = '';
	let doResolveEarly: () => void;
	let doRejectEarly: (err: any) => void;
	const resolveEarly = new Promise<void>((resolve, reject) => {
		doResolveEarly = resolve;
		doRejectEarly = reject;
	});
	p.stdout.on('data', (chunk: Buffer) => {
		stdout.push(chunk);
		const str = stdoutDecoder.write(chunk);
		if (print === 'continuous') {
			params.output.write(str.replace(/\r?\n/g, '\r\n'));
		}
		stdoutStr += str;
		if (options.resolveOn && options.resolveOn.exec(stdoutStr)) {
			doResolveEarly();
		}
	});
	p.stderr.on('data', (chunk: Buffer) => {
		stderr.push(chunk);
		stderrStr += stderrDecoder.write(chunk);
	});
	if (options.stdin instanceof Buffer) {
		p.stdin.write(options.stdin, err => {
			if (err) {
				doRejectEarly(err);
			}
		});
		p.stdin.end();
	} else if (options.stdin instanceof fs.ReadStream) {
		options.stdin.pipe(p.stdin);
	}
	const exit = await Promise.race([p.exit, resolveEarly]);
	const stdoutBuf = Buffer.concat(stdout);
	const stderrBuf = Buffer.concat(stderr);
	if (print === 'end') {
		params.output.write(stdoutStr.replace(/\r?\n/g, '\r\n'));
		params.output.write(toErrorText(stderrStr));
	}
	const cmdOutput = `${stdoutStr}\n${stderrStr}`;
	if (exit && (exit.code || exit.signal)) {
		return Promise.reject({
			message: `Command failed: ${cmd.join(' ')}`,
			cmdOutput,
			stdout: stdoutBuf,
			stderr: stderrBuf,
			code: exit.code,
			signal: exit.signal,
		});
	}
	return {
		cmdOutput,
		stdout: stdoutBuf,
		stderr: stderrBuf,
	};
}

async function patchEtcEnvironment(params: ResolverParameters, containerProperties: ContainerProperties) {
	const markerFile = path.posix.join(getSystemVarFolder(params), `.patchEtcEnvironmentMarker`);
	if (params.allowSystemConfigChange && containerProperties.launchRootShellServer && !(await isFile(containerProperties.shellServer, markerFile))) {
		const rootShellServer = await containerProperties.launchRootShellServer();
		if (await createFile(rootShellServer, markerFile)) {
			await rootShellServer.exec(`cat >> /etc/environment <<'etcEnvironmentEOF'
${Object.keys(containerProperties.env).map(k => `\n${k}="${containerProperties.env[k]}"`).join('')}
etcEnvironmentEOF
`);
		}
	}
}

async function patchEtcProfile(params: ResolverParameters, containerProperties: ContainerProperties) {
	const markerFile = path.posix.join(getSystemVarFolder(params), `.patchEtcProfileMarker`);
	if (params.allowSystemConfigChange && containerProperties.launchRootShellServer && !(await isFile(containerProperties.shellServer, markerFile))) {
		const rootShellServer = await containerProperties.launchRootShellServer();
		if (await createFile(rootShellServer, markerFile)) {
			await rootShellServer.exec(`sed -i -E 's/((^|\\s)PATH=)([^\\$]*)$/\\1\${PATH:-\\3}/g' /etc/profile || true`);
		}
	}
}

async function probeUserEnv(params: { defaultUserEnvProbe: UserEnvProbe; allowSystemConfigChange: boolean; output: Log; containerSessionDataFolder?: string }, containerProperties: { shell: string; remoteExec: ExecFunction; installFolder?: string; env?: NodeJS.ProcessEnv; shellServer?: ShellServer; launchRootShellServer?: (() => Promise<ShellServer>); user?: string }, config?: CommonMergedDevContainerConfig) {
	let userEnvProbe = getUserEnvProb(config, params);
	if (!userEnvProbe || userEnvProbe === 'none') {
		return {};
	}

	let env = await readUserEnvFromCache(userEnvProbe, params, containerProperties.shellServer);
	if (env) {
		return env;
	}

	params.output.write('userEnvProbe: not found in cache');
	env = await runUserEnvProbe(userEnvProbe, params, containerProperties, 'cat /proc/self/environ', '\0');
	if (!env) {
		params.output.write('userEnvProbe: falling back to printenv');
		env = await runUserEnvProbe(userEnvProbe, params, containerProperties, 'printenv', '\n');
	}

	if (env) {
		await updateUserEnvCache(env, userEnvProbe, params, containerProperties.shellServer);
	}

	return env || {};
}

async function readUserEnvFromCache(userEnvProbe: UserEnvProbe, params: { output: Log; containerSessionDataFolder?: string }, shellServer?: ShellServer) {
	if (!shellServer || !params.containerSessionDataFolder) {
		return undefined;
	}

	const cacheFile = getUserEnvCacheFilePath(userEnvProbe, params.containerSessionDataFolder);
	try {
		if (await isFile(shellServer, cacheFile)) {
			const { stdout } = await shellServer.exec(`cat '${cacheFile}'`);
			return JSON.parse(stdout);
		}
	}
	catch (e) {
		params.output.write(`Failed to read/parse user env cache: ${e}`, LogLevel.Error);
	}

	return undefined;
}

async function updateUserEnvCache(env: Record<string, string>, userEnvProbe: UserEnvProbe, params: { output: Log; containerSessionDataFolder?: string }, shellServer?: ShellServer) {
	if (!shellServer || !params.containerSessionDataFolder) {
		return;
	}

	const cacheFile = getUserEnvCacheFilePath(userEnvProbe, params.containerSessionDataFolder);
	try {
		await shellServer.exec(`mkdir -p '${path.posix.dirname(cacheFile)}' && cat > '${cacheFile}' << 'envJSON'
${JSON.stringify(env, null, '\t')}
envJSON
`);
	}
	catch (e) {
		params.output.write(`Failed to cache user env: ${e}`, LogLevel.Error);
	}
}

function getUserEnvCacheFilePath(userEnvProbe: UserEnvProbe, cacheFolder: string): string {
	return path.posix.join(cacheFolder, `env-${userEnvProbe}.json`);
}

async function runUserEnvProbe(userEnvProbe: UserEnvProbe, params: { allowSystemConfigChange: boolean; output: Log }, containerProperties: { shell: string; remoteExec: ExecFunction; installFolder?: string; env?: NodeJS.ProcessEnv; shellServer?: ShellServer; launchRootShellServer?: (() => Promise<ShellServer>); user?: string }, cmd: string, sep: string) {
	if (userEnvProbe === 'none') {
		return {};
	}
	try {
		// From VS Code's shellEnv.ts

		const mark = crypto.randomUUID();
		const regex = new RegExp(mark + '([^]*)' + mark);
		const systemShellUnix = containerProperties.shell;
		params.output.write(`userEnvProbe shell: ${systemShellUnix}`);

		// handle popular non-POSIX shells
		const name = path.posix.basename(systemShellUnix);
		const command = `echo -n ${mark}; ${cmd}; echo -n ${mark}`;
		let shellArgs: string[];
		if (/^pwsh(-preview)?$/.test(name)) {
			shellArgs = userEnvProbe === 'loginInteractiveShell' || userEnvProbe === 'loginShell' ?
				['-Login', '-Command'] : // -Login must be the first option.
				['-Command'];
		} else {
			shellArgs = [
				userEnvProbe === 'loginInteractiveShell' ? '-lic' :
					userEnvProbe === 'loginShell' ? '-lc' :
						userEnvProbe === 'interactiveShell' ? '-ic' :
							'-c'
			];
		}

		const traceOutput = makeLog(params.output, LogLevel.Trace);
		const resultP = runRemoteCommandNoPty({ output: traceOutput }, { remoteExec: containerProperties.remoteExec }, [systemShellUnix, ...shellArgs, command], containerProperties.installFolder);
		Promise.race([resultP, delay(2000)])
			.then(async result => {
				if (!result) {
					let processes: Process[];
					const shellServer = containerProperties.shellServer || await launch(containerProperties.remoteExec, params.output);
					try {
						({ processes } = await findProcesses(shellServer));
					} finally {
						if (!containerProperties.shellServer) {
							await shellServer.process.terminate();
						}
					}
					const shell = processes.find(p => p.cmd.startsWith(systemShellUnix) && p.cmd.indexOf(mark) !== -1);
					if (shell) {
						const index = buildProcessTrees(processes);
						const tree = index[shell.pid];
						params.output.write(`userEnvProbe is taking longer than 2 seconds. Process tree:
${processTreeToString(tree)}`);
					} else {
						params.output.write(`userEnvProbe is taking longer than 2 seconds. Process not found.`);
					}
				}
			}, () => undefined)
			.catch(err => params.output.write(toErrorText(err && (err.stack || err.message) || 'Error reading process tree.')));
		const result = await Promise.race([resultP, delay(10000)]);
		if (!result) {
			params.output.write(toErrorText(`userEnvProbe is taking longer than 10 seconds. Avoid waiting for user input in your shell's startup scripts. Continuing.`));
			return {};
		}
		const raw = result.stdout.toString();
		const match = regex.exec(raw);
		const rawStripped = match ? match[1] : '';
		if (!rawStripped) {
			return undefined; // assume error
		}
		const env = rawStripped.split(sep)
			.reduce((env, e) => {
				const i = e.indexOf('=');
				if (i !== -1) {
					env[e.substring(0, i)] = e.substring(i + 1);
				}
				return env;
			}, {} as Record<string, string>);
		params.output.write(`userEnvProbe parsed: ${JSON.stringify(env, undefined, '  ')}`, LogLevel.Trace);
		delete env.PWD;

		const shellPath = env.PATH;
		const containerPath = containerProperties.env?.PATH;
		const doMergePaths = !(params.allowSystemConfigChange && containerProperties.launchRootShellServer) && shellPath && containerPath;
		if (doMergePaths) {
			const user = containerProperties.user;
			env.PATH = mergePaths(shellPath, containerPath!, user === 'root' || user === '0');
		}
		params.output.write(`userEnvProbe PATHs:
Probe:     ${typeof shellPath === 'string' ? `'${shellPath}'` : 'None'}
Container: ${typeof containerPath === 'string' ? `'${containerPath}'` : 'None'}${doMergePaths ? `
Merged:    ${typeof env.PATH === 'string' ? `'${env.PATH}'` : 'None'}` : ''}`);

		return env;
	} catch (err) {
		params.output.write(toErrorText(err && (err.stack || err.message) || 'Error reading shell environment.'));
		return {};
	}
}

function getUserEnvProb(config: CommonMergedDevContainerConfig | undefined, params: { defaultUserEnvProbe: UserEnvProbe; allowSystemConfigChange: boolean; output: Log }) {
	let userEnvProbe = config?.userEnvProbe;
	params.output.write(`userEnvProbe: ${userEnvProbe || params.defaultUserEnvProbe}${userEnvProbe ? '' : ' (default)'}`);
	if (!userEnvProbe) {
		userEnvProbe = params.defaultUserEnvProbe;
	}
	return userEnvProbe;
}

function mergePaths(shellPath: string, containerPath: string, rootUser: boolean) {
	const result = shellPath.split(':');
	let insertAt = 0;
	for (const entry of containerPath.split(':')) {
		const i = result.indexOf(entry);
		if (i === -1) {
			if (rootUser || !/\/sbin(\/|$)/.test(entry)) {
				result.splice(insertAt++, 0, entry);
			}
		} else {
			insertAt = i + 1;
		}
	}
	return result.join(':');
}

export async function finishBackgroundTasks(tasks: (Promise<void> | (() => Promise<void>))[]) {
	for (const task of tasks) {
		await (typeof task === 'function' ? task() : task);
	}
}
