/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

import { mapNodeOSToGOOS, mapNodeArchitectureToGOARCH } from '../spec-configuration/containerCollectionsOCI';
import { DockerResolverParameters, DevContainerAuthority, UpdateRemoteUserUIDDefault, BindMountConsistency, getCacheFolder, GPUAvailability } from './utils';
import { createNullLifecycleHook, finishBackgroundTasks, ResolverParameters, UserEnvProbe } from '../spec-common/injectHeadless';
import { GoARCH, GoOS, getCLIHost, loadNativeModule } from '../spec-common/commonUtils';
import { resolve } from './configContainer';
import { URI } from 'vscode-uri';
import { LogLevel, LogDimensions, toErrorText, createCombinedLog, createTerminalLog, Log, makeLog, LogFormat, createJSONLog, createPlainLog, LogHandler, replaceAllLog } from '../spec-utils/log';
import { dockerComposeCLIConfig } from './dockerCompose';
import { Mount } from '../spec-configuration/containerFeaturesConfiguration';
import { getPackageConfig, PackageConfiguration } from '../spec-utils/product';
import { dockerBuildKitVersion, isPodman } from '../spec-shutdown/dockerUtils';
import { Event } from '../spec-utils/event';


export interface ProvisionOptions {
	dockerPath: string | undefined;
	dockerComposePath: string | undefined;
	containerDataFolder: string | undefined;
	containerSystemDataFolder: string | undefined;
	workspaceFolder: string | undefined;
	workspaceMountConsistency?: BindMountConsistency;
	gpuAvailability?: GPUAvailability;
	mountWorkspaceGitRoot: boolean;
	configFile: URI | undefined;
	overrideConfigFile: URI | undefined;
	logLevel: LogLevel;
	logFormat: LogFormat;
	log: (text: string) => void;
	terminalDimensions: LogDimensions | undefined;
	onDidChangeTerminalDimensions?: Event<LogDimensions>;
	defaultUserEnvProbe: UserEnvProbe;
	removeExistingContainer: boolean;
	buildNoCache: boolean;
	expectExistingContainer: boolean;
	postCreateEnabled: boolean;
	skipNonBlocking: boolean;
	prebuild: boolean;
	persistedFolder: string | undefined;
	additionalMounts: Mount[];
	updateRemoteUserUIDDefault: UpdateRemoteUserUIDDefault;
	remoteEnv: Record<string, string>;
	additionalCacheFroms: string[];
	useBuildKit: 'auto' | 'never';
	omitLoggerHeader?: boolean | undefined;
	buildxPlatform: string | undefined;
	buildxPush: boolean;
	additionalLabels: string[];
	buildxOutput: string | undefined;
	buildxCacheTo: string | undefined;
	additionalFeatures?: Record<string, string | boolean | Record<string, string | boolean>>;
	skipFeatureAutoMapping: boolean;
	skipPostAttach: boolean;
	containerSessionDataFolder?: string;
	skipPersistingCustomizationsFromFeatures: boolean;
	omitConfigRemotEnvFromMetadata?: boolean;
	dotfiles: {
		repository?: string;
		installCommand?: string;
		targetPath?: string;
	};
	experimentalLockfile?: boolean;
	experimentalFrozenLockfile?: boolean;
	secretsP?: Promise<Record<string, string>>;
	omitSyntaxDirective?: boolean;
	includeConfig?: boolean;
	includeMergedConfig?: boolean;
}

export async function launch(options: ProvisionOptions, providedIdLabels: string[] | undefined, disposables: (() => Promise<unknown> | undefined)[]) {
	const params = await createDockerParams(options, disposables);
	const output = params.common.output;
	const text = 'Resolving Remote';
	const start = output.start(text);

	const result = await resolve(params, options.configFile, options.overrideConfigFile, providedIdLabels, options.additionalFeatures ?? {});
	output.stop(text, start);
	const { dockerContainerId, composeProjectName } = result;
	return {
		containerId: dockerContainerId,
		composeProjectName,
		remoteUser: result.properties.user,
		remoteWorkspaceFolder: result.properties.remoteWorkspaceFolder,
		configuration: options.includeConfig ? result.config : undefined,
		mergedConfiguration: options.includeMergedConfig ? result.mergedConfig : undefined,
		finishBackgroundTasks: async () => {
			try {
				await finishBackgroundTasks(result.params.backgroundTasks);
			} catch (err) {
				output.write(toErrorText(String(err && (err.stack || err.message) || err)));
			}
		},
	};
}

export async function createDockerParams(options: ProvisionOptions, disposables: (() => Promise<unknown> | undefined)[]): Promise<DockerResolverParameters> {
	const { persistedFolder, additionalMounts, updateRemoteUserUIDDefault, containerDataFolder, containerSystemDataFolder, workspaceMountConsistency, gpuAvailability, mountWorkspaceGitRoot, remoteEnv, experimentalLockfile, experimentalFrozenLockfile, omitLoggerHeader, secretsP } = options;
	let parsedAuthority: DevContainerAuthority | undefined;
	if (options.workspaceFolder) {
		parsedAuthority = { hostPath: options.workspaceFolder } as DevContainerAuthority;
	}
	const extensionPath = path.join(__dirname, '..', '..');
	const sessionStart = new Date();
	const pkg = getPackageConfig();
	const output = createLog(options, pkg, sessionStart, disposables, omitLoggerHeader, secretsP ? await secretsP : undefined);

	const appRoot = undefined;
	const cwd = options.workspaceFolder || process.cwd();
	const allowInheritTTY = options.logFormat === 'text';
	const cliHost = await getCLIHost(cwd, loadNativeModule, allowInheritTTY);
	const sessionId = crypto.randomUUID();

	const common: ResolverParameters = {
		prebuild: options.prebuild,
		computeExtensionHostEnv: false,
		package: pkg,
		containerDataFolder,
		containerSystemDataFolder,
		appRoot,
		extensionPath, // TODO: rename to packagePath
		sessionId,
		sessionStart,
		cliHost,
		env: cliHost.env,
		cwd,
		isLocalContainer: false,
		progress: () => { },
		output,
		allowSystemConfigChange: true,
		defaultUserEnvProbe: options.defaultUserEnvProbe,
		lifecycleHook: createNullLifecycleHook(options.postCreateEnabled, options.skipNonBlocking, output),
		getLogLevel: () => options.logLevel,
		onDidChangeLogLevel: () => ({ dispose() { } }),
		loadNativeModule,
		allowInheritTTY,
		shutdowns: [],
		backgroundTasks: [],
		persistedFolder: persistedFolder || await getCacheFolder(cliHost), // Fallback to tmp folder, even though that isn't 'persistent'
		remoteEnv,
		secretsP,
		buildxPlatform: options.buildxPlatform,
		buildxPush: options.buildxPush,
		buildxOutput: options.buildxOutput,
		buildxCacheTo: options.buildxCacheTo,
		skipFeatureAutoMapping: options.skipFeatureAutoMapping,
		skipPostAttach: options.skipPostAttach,
		containerSessionDataFolder: options.containerSessionDataFolder,
		skipPersistingCustomizationsFromFeatures: options.skipPersistingCustomizationsFromFeatures,
		omitConfigRemotEnvFromMetadata: options.omitConfigRemotEnvFromMetadata,
		dotfilesConfiguration: {
			repository: options.dotfiles.repository,
			installCommand: options.dotfiles.installCommand,
			targetPath: options.dotfiles.targetPath || '~/dotfiles',
		},
		omitSyntaxDirective: options.omitSyntaxDirective,
	};

	const dockerPath = options.dockerPath || 'docker';
	const dockerComposePath = options.dockerComposePath || 'docker-compose';
	const dockerComposeCLI = dockerComposeCLIConfig({
		exec: cliHost.exec,
		env: cliHost.env,
		output: common.output,
	}, dockerPath, dockerComposePath);

	const platformInfo = (() => {
		if (common.buildxPlatform) {
			const slash1 = common.buildxPlatform.indexOf('/');
			const slash2 = common.buildxPlatform.indexOf('/', slash1 + 1);
			// `--platform linux/amd64/v3` `--platform linux/arm64/v8`
			if (slash2 !== -1) {
				return {
					os: <GoOS> common.buildxPlatform.slice(0, slash1),
					arch: <GoARCH> common.buildxPlatform.slice(slash1 + 1, slash2),
					variant: common.buildxPlatform.slice(slash2 + 1),
				};
			}
			// `--platform linux/amd64` and `--platform linux/arm64`
			return {
				os: <GoOS> common.buildxPlatform.slice(0, slash1),
				arch: <GoARCH> common.buildxPlatform.slice(slash1 + 1),
			};
		} else {
			// `--platform` omitted
			return {
				os: mapNodeOSToGOOS(cliHost.platform),
				arch: mapNodeArchitectureToGOARCH(cliHost.arch),
			};
		}
	})();

	const buildKitVersion = options.useBuildKit === 'never' ? undefined : (await dockerBuildKitVersion({
		cliHost,
		dockerCLI: dockerPath,
		dockerComposeCLI,
		env: cliHost.env,
		output,
		platformInfo
	}));
	return {
		common,
		parsedAuthority,
		dockerCLI: dockerPath,
		isPodman: await isPodman({ exec: cliHost.exec, cmd: dockerPath, env: cliHost.env, output }),
		dockerComposeCLI: dockerComposeCLI,
		dockerEnv: cliHost.env,
		workspaceMountConsistencyDefault: workspaceMountConsistency,
		gpuAvailability: gpuAvailability || 'detect',
		mountWorkspaceGitRoot,
		updateRemoteUserUIDOnMacOS: false,
		cacheMount: 'bind',
		removeOnStartup: options.removeExistingContainer,
		buildNoCache: options.buildNoCache,
		expectExistingContainer: options.expectExistingContainer,
		additionalMounts,
		userRepositoryConfigurationPaths: [],
		updateRemoteUserUIDDefault,
		additionalCacheFroms: options.additionalCacheFroms,
		buildKitVersion,
		isTTY: process.stdout.isTTY || options.logFormat === 'json',
		experimentalLockfile,
		experimentalFrozenLockfile,
		buildxPlatform: common.buildxPlatform,
		buildxPush: common.buildxPush,
		additionalLabels: options.additionalLabels,
		buildxOutput: common.buildxOutput,
		buildxCacheTo: common.buildxCacheTo,
		platformInfo
	};
}

export interface LogOptions {
	logLevel: LogLevel;
	logFormat: LogFormat;
	log: (text: string) => void;
	terminalDimensions: LogDimensions | undefined;
	onDidChangeTerminalDimensions?: Event<LogDimensions>;
}

export function createLog(options: LogOptions, pkg: PackageConfiguration, sessionStart: Date, disposables: (() => Promise<unknown> | undefined)[], omitHeader?: boolean, secrets?: Record<string, string>) {
	const header = omitHeader ? undefined : `${pkg.name} ${pkg.version}. Node.js ${process.version}. ${os.platform()} ${os.release()} ${os.arch()}.`;
	const output = createLogFrom(options, sessionStart, header, secrets);
	output.dimensions = options.terminalDimensions;
	output.onDidChangeDimensions = options.onDidChangeTerminalDimensions;
	disposables.push(() => output.join());
	return output;
}

function createLogFrom({ log: write, logLevel, logFormat }: LogOptions, sessionStart: Date, header: string | undefined = undefined, secrets?: Record<string, string>): Log & { join(): Promise<void> } {
	const handler = logFormat === 'json' ? createJSONLog(write, () => logLevel, sessionStart) :
		process.stdout.isTTY ? createTerminalLog(write, () => logLevel, sessionStart) :
			createPlainLog(write, () => logLevel);
	const log = {
		...makeLog(createCombinedLog([maskSecrets(handler, secrets)], header)),
		join: async () => {
			// TODO: wait for write() to finish.
		},
	};
	return log;
}

function maskSecrets(handler: LogHandler, secrets?: Record<string, string>): LogHandler {
	if (secrets) {
		const mask = '********';
		const secretValues = Object.values(secrets);
		return replaceAllLog(handler, secretValues, mask);
	}

	return handler;
}
