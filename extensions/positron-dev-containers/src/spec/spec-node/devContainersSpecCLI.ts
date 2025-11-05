/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import yargs, { Argv } from 'yargs';
import textTable from 'text-table';

import * as jsonc from 'jsonc-parser';

import { createDockerParams, createLog, launch, ProvisionOptions } from './devContainers';
import { SubstitutedConfig, createContainerProperties, envListToObj, inspectDockerImage, isDockerFileConfig, SubstituteConfig, addSubstitution, findContainerAndIdLabels, getCacheFolder, runAsyncHandler } from './utils';
import { URI } from 'vscode-uri';
import { ContainerError } from '../spec-common/errors';
import { Log, LogDimensions, LogLevel, makeLog, mapLogLevel } from '../spec-utils/log';
import { probeRemoteEnv, runLifecycleHooks, runRemoteCommand, UserEnvProbe, setupInContainer } from '../spec-common/injectHeadless';
import { extendImage } from './containerFeatures';
import { dockerCLI, DockerCLIParameters, dockerPtyCLI, inspectContainer } from '../spec-shutdown/dockerUtils';
import { buildAndExtendDockerCompose, dockerComposeCLIConfig, getDefaultImageName, getProjectName, readDockerComposeConfig, readVersionPrefix } from './dockerCompose';
import { DevContainerFromDockerComposeConfig, DevContainerFromDockerfileConfig, getDockerComposeFilePaths } from '../spec-configuration/configuration';
import { workspaceFromPath } from '../spec-utils/workspaces';
import { readDevContainerConfigFile } from './configContainer';
import { getDefaultDevContainerConfigPath, getDevContainerConfigPathIn, uriToFsPath } from '../spec-configuration/configurationCommonUtils';
import { CLIHost, getCLIHost } from '../spec-common/cliHost';
import { loadNativeModule, processSignals } from '../spec-common/commonUtils';
import { loadVersionInfo } from '../spec-configuration/containerFeaturesConfiguration';
import { featuresTestOptions, featuresTestHandler } from './featuresCLI/test';
import { featuresPackageHandler, featuresPackageOptions } from './featuresCLI/package';
import { featuresPublishHandler, featuresPublishOptions } from './featuresCLI/publish';
import { beforeContainerSubstitute, containerSubstitute, substitute } from '../spec-common/variableSubstitution';
import { getPackageConfig, } from '../spec-utils/product';
import { getDevcontainerMetadata, getImageBuildInfo, getImageMetadataFromContainer, ImageMetadataEntry, lifecycleCommandOriginMapFromMetadata, mergeConfiguration, MergedDevContainerConfig } from './imageMetadata';
import { templatesPublishHandler, templatesPublishOptions } from './templatesCLI/publish';
import { templateApplyHandler, templateApplyOptions } from './templatesCLI/apply';
import { featuresInfoHandler as featuresInfoHandler, featuresInfoOptions } from './featuresCLI/info';
import { bailOut, buildNamedImageAndExtend } from './singleContainer';
import { Event, NodeEventEmitter } from '../spec-utils/event';
import { ensureNoDisallowedFeatures } from './disallowedFeatures';
import { featuresResolveDependenciesHandler, featuresResolveDependenciesOptions } from './featuresCLI/resolveDependencies';
import { getFeatureIdWithoutVersion } from '../spec-configuration/containerFeaturesOCI';
import { featuresUpgradeHandler, featuresUpgradeOptions } from './upgradeCommand';
import { readFeaturesConfig } from './featureUtils';
import { featuresGenerateDocsHandler, featuresGenerateDocsOptions } from './featuresCLI/generateDocs';
import { templatesGenerateDocsHandler, templatesGenerateDocsOptions } from './templatesCLI/generateDocs';
import { mapNodeOSToGOOS, mapNodeArchitectureToGOARCH } from '../spec-configuration/containerCollectionsOCI';
import { templateMetadataHandler, templateMetadataOptions } from './templatesCLI/metadata';

const defaultDefaultUserEnvProbe: UserEnvProbe = 'loginInteractiveShell';

const mountRegex = /^type=(bind|volume),source=([^,]+),target=([^,]+)(?:,external=(true|false))?$/;

(async () => {

	const packageFolder = path.join(__dirname, '..', '..');
	const version = getPackageConfig().version;
	const argv = process.argv.slice(2);
	const restArgs = argv[0] === 'exec' && argv[1] !== '--help'; // halt-at-non-option doesn't work in subcommands: https://github.com/yargs/yargs/issues/1417
	const y = yargs([])
		.parserConfiguration({
			// By default, yargs allows `--no-myoption` to set a boolean `--myoption` to false
			// Disable this to allow `--no-cache` on the `build` command to align with `docker build` syntax
			'boolean-negation': false,
			'halt-at-non-option': restArgs,
		})
		.scriptName('devcontainer')
		.version(version)
		.demandCommand()
		.strict();
	y.wrap(Math.min(120, y.terminalWidth()));
	y.command('up', 'Create and run dev container', provisionOptions, provisionHandler);
	y.command('set-up', 'Set up an existing container as a dev container', setUpOptions, setUpHandler);
	y.command('build [path]', 'Build a dev container image', buildOptions, buildHandler);
	y.command('run-user-commands', 'Run user commands', runUserCommandsOptions, runUserCommandsHandler);
	y.command('read-configuration', 'Read configuration', readConfigurationOptions, readConfigurationHandler);
	y.command('outdated', 'Show current and available versions', outdatedOptions, outdatedHandler);
	y.command('upgrade', 'Upgrade lockfile', featuresUpgradeOptions, featuresUpgradeHandler);
	y.command('features', 'Features commands', (y: Argv) => {
		y.command('test [target]', 'Test Features', featuresTestOptions, featuresTestHandler);
		y.command('package <target>', 'Package Features', featuresPackageOptions, featuresPackageHandler);
		y.command('publish <target>', 'Package and publish Features', featuresPublishOptions, featuresPublishHandler);
		y.command('info <mode> <feature>', 'Fetch metadata for a published Feature', featuresInfoOptions, featuresInfoHandler);
		y.command('resolve-dependencies', 'Read and resolve dependency graph from a configuration', featuresResolveDependenciesOptions, featuresResolveDependenciesHandler);
		y.command('generate-docs', 'Generate documentation', featuresGenerateDocsOptions, featuresGenerateDocsHandler);
	});
	y.command('templates', 'Templates commands', (y: Argv) => {
		y.command('apply', 'Apply a template to the project', templateApplyOptions, templateApplyHandler);
		y.command('publish <target>', 'Package and publish templates', templatesPublishOptions, templatesPublishHandler);
		y.command('metadata <templateId>', 'Fetch a published Template\'s metadata', templateMetadataOptions, templateMetadataHandler);
		y.command('generate-docs', 'Generate documentation', templatesGenerateDocsOptions, templatesGenerateDocsHandler);
	});
	y.command(restArgs ? ['exec', '*'] : ['exec <cmd> [args..]'], 'Execute a command on a running dev container', execOptions, execHandler);
	y.epilog(`devcontainer@${version} ${packageFolder}`);
	y.parse(restArgs ? argv.slice(1) : argv);

})().catch(console.error);

export type UnpackArgv<T> = T extends Argv<infer U> ? U : T;

function provisionOptions(y: Argv) {
	return y.options({
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'container-data-folder': { type: 'string', description: 'Container data folder where user data inside the container will be stored.' },
		'container-system-data-folder': { type: 'string', description: 'Container system data folder where system data inside the container will be stored.' },
		'workspace-folder': { type: 'string', description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'workspace-mount-consistency': { choices: ['consistent' as 'consistent', 'cached' as 'cached', 'delegated' as 'delegated'], default: 'cached' as 'cached', description: 'Workspace mount consistency.' },
		'gpu-availability': { choices: ['all' as 'all', 'detect' as 'detect', 'none' as 'none'], default: 'detect' as 'detect', description: 'Availability of GPUs in case the dev container requires any. `all` expects a GPU to be available.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'id-label': { type: 'string', description: 'Id label(s) of the format name=value. These will be set on the container and used to query for an existing container. If no --id-label is given, one will be inferred from the --workspace-folder path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'default-user-env-probe': { choices: ['none' as 'none', 'loginInteractiveShell' as 'loginInteractiveShell', 'interactiveShell' as 'interactiveShell', 'loginShell' as 'loginShell'], default: defaultDefaultUserEnvProbe, description: 'Default value for the devcontainer.json\'s "userEnvProbe".' },
		'update-remote-user-uid-default': { choices: ['never' as 'never', 'on' as 'on', 'off' as 'off'], default: 'on' as 'on', description: 'Default for updating the remote user\'s UID and GID to the local user\'s one.' },
		'remove-existing-container': { type: 'boolean', default: false, description: 'Removes the dev container if it already exists.' },
		'build-no-cache': { type: 'boolean', default: false, description: 'Builds the image with `--no-cache` if the container does not exist.' },
		'expect-existing-container': { type: 'boolean', default: false, description: 'Fail if the container does not exist.' },
		'skip-post-create': { type: 'boolean', default: false, description: 'Do not run onCreateCommand, updateContentCommand, postCreateCommand, postStartCommand or postAttachCommand and do not install dotfiles.' },
		'skip-non-blocking-commands': { type: 'boolean', default: false, description: 'Stop running user commands after running the command configured with waitFor or the updateContentCommand by default.' },
		prebuild: { type: 'boolean', default: false, description: 'Stop after onCreateCommand and updateContentCommand, rerunning updateContentCommand if it has run before.' },
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'mount': { type: 'string', description: 'Additional mount point(s). Format: type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]' },
		'remote-env': { type: 'string', description: 'Remote environment variables of the format name=value. These will be added when executing the user commands.' },
		'cache-from': { type: 'string', description: 'Additional image to use as potential layer cache during image building' },
		'cache-to': { type: 'string', description: 'Additional image to use as potential layer cache during image building' },
		'buildkit': { choices: ['auto' as 'auto', 'never' as 'never'], default: 'auto' as 'auto', description: 'Control whether BuildKit should be used' },
		'additional-features': { type: 'string', description: 'Additional features to apply to the dev container (JSON as per "features" section in devcontainer.json)' },
		'skip-feature-auto-mapping': { type: 'boolean', default: false, hidden: true, description: 'Temporary option for testing.' },
		'skip-post-attach': { type: 'boolean', default: false, description: 'Do not run postAttachCommand.' },
		'dotfiles-repository': { type: 'string', description: 'URL of a dotfiles Git repository (e.g., https://github.com/owner/repository.git)' },
		'dotfiles-install-command': { type: 'string', description: 'The command to run after cloning the dotfiles repository. Defaults to run the first file of `install.sh`, `install`, `bootstrap.sh`, `bootstrap`, `setup.sh` and `setup` found in the dotfiles repository`s root folder.' },
		'dotfiles-target-path': { type: 'string', default: '~/dotfiles', description: 'The path to clone the dotfiles repository to. Defaults to `~/dotfiles`.' },
		'container-session-data-folder': { type: 'string', description: 'Folder to cache CLI data, for example userEnvProbe results' },
		'omit-config-remote-env-from-metadata': { type: 'boolean', default: false, hidden: true, description: 'Omit remoteEnv from devcontainer.json for container metadata label' },
		'secrets-file': { type: 'string', description: 'Path to a json file containing secret environment variables as key-value pairs.' },
		'experimental-lockfile': { type: 'boolean', default: false, hidden: true, description: 'Write lockfile' },
		'experimental-frozen-lockfile': { type: 'boolean', default: false, hidden: true, description: 'Ensure lockfile remains unchanged' },
		'omit-syntax-directive': { type: 'boolean', default: false, hidden: true, description: 'Omit Dockerfile syntax directives' },
		'include-configuration': { type: 'boolean', default: false, description: 'Include configuration in result.' },
		'include-merged-configuration': { type: 'boolean', default: false, description: 'Include merged configuration in result.' },
	})
		.check(argv => {
			const idLabels = (argv['id-label'] && (Array.isArray(argv['id-label']) ? argv['id-label'] : [argv['id-label']])) as string[] | undefined;
			if (idLabels?.some(idLabel => !/.+=.+/.test(idLabel))) {
				throw new Error('Unmatched argument format: id-label must match <name>=<value>');
			}
			if (!(argv['workspace-folder'] || argv['id-label'])) {
				throw new Error('Missing required argument: workspace-folder or id-label');
			}
			if (!(argv['workspace-folder'] || argv['override-config'])) {
				throw new Error('Missing required argument: workspace-folder or override-config');
			}
			const mounts = (argv.mount && (Array.isArray(argv.mount) ? argv.mount : [argv.mount])) as string[] | undefined;
			if (mounts?.some(mount => !mountRegex.test(mount))) {
				throw new Error('Unmatched argument format: mount must match type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]');
			}
			const remoteEnvs = (argv['remote-env'] && (Array.isArray(argv['remote-env']) ? argv['remote-env'] : [argv['remote-env']])) as string[] | undefined;
			if (remoteEnvs?.some(remoteEnv => !/.+=.*/.test(remoteEnv))) {
				throw new Error('Unmatched argument format: remote-env must match <name>=<value>');
			}
			return true;
		});
}

type ProvisionArgs = UnpackArgv<ReturnType<typeof provisionOptions>>;

function provisionHandler(args: ProvisionArgs) {
	runAsyncHandler(provision.bind(null, args));
}

async function provision({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'container-data-folder': containerDataFolder,
	'container-system-data-folder': containerSystemDataFolder,
	'workspace-folder': workspaceFolderArg,
	'workspace-mount-consistency': workspaceMountConsistency,
	'gpu-availability': gpuAvailability,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	'id-label': idLabel,
	config,
	'override-config': overrideConfig,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'default-user-env-probe': defaultUserEnvProbe,
	'update-remote-user-uid-default': updateRemoteUserUIDDefault,
	'remove-existing-container': removeExistingContainer,
	'build-no-cache': buildNoCache,
	'expect-existing-container': expectExistingContainer,
	'skip-post-create': skipPostCreate,
	'skip-non-blocking-commands': skipNonBlocking,
	prebuild,
	mount,
	'remote-env': addRemoteEnv,
	'cache-from': addCacheFrom,
	'cache-to': addCacheTo,
	'buildkit': buildkit,
	'additional-features': additionalFeaturesJson,
	'skip-feature-auto-mapping': skipFeatureAutoMapping,
	'skip-post-attach': skipPostAttach,
	'dotfiles-repository': dotfilesRepository,
	'dotfiles-install-command': dotfilesInstallCommand,
	'dotfiles-target-path': dotfilesTargetPath,
	'container-session-data-folder': containerSessionDataFolder,
	'omit-config-remote-env-from-metadata': omitConfigRemotEnvFromMetadata,
	'secrets-file': secretsFile,
	'experimental-lockfile': experimentalLockfile,
	'experimental-frozen-lockfile': experimentalFrozenLockfile,
	'omit-syntax-directive': omitSyntaxDirective,
	'include-configuration': includeConfig,
	'include-merged-configuration': includeMergedConfig,
}: ProvisionArgs) {

	const workspaceFolder = workspaceFolderArg ? path.resolve(process.cwd(), workspaceFolderArg) : undefined;
	const addRemoteEnvs = addRemoteEnv ? (Array.isArray(addRemoteEnv) ? addRemoteEnv as string[] : [addRemoteEnv]) : [];
	const addCacheFroms = addCacheFrom ? (Array.isArray(addCacheFrom) ? addCacheFrom as string[] : [addCacheFrom]) : [];
	const additionalFeatures = additionalFeaturesJson ? jsonc.parse(additionalFeaturesJson) as Record<string, string | boolean | Record<string, string | boolean>> : {};
	const providedIdLabels = idLabel ? Array.isArray(idLabel) ? idLabel as string[] : [idLabel] : undefined;

	const cwd = workspaceFolder || process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule, logFormat === 'text');
	const secretsP = readSecretsFromFile({ secretsFile, cliHost });

	const options: ProvisionOptions = {
		dockerPath,
		dockerComposePath,
		containerDataFolder,
		containerSystemDataFolder,
		workspaceFolder,
		workspaceMountConsistency,
		gpuAvailability,
		mountWorkspaceGitRoot,
		configFile: config ? URI.file(path.resolve(process.cwd(), config)) : undefined,
		overrideConfigFile: overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined,
		logLevel: mapLogLevel(logLevel),
		logFormat,
		log: text => process.stderr.write(text),
		terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
		defaultUserEnvProbe,
		removeExistingContainer,
		buildNoCache,
		expectExistingContainer,
		postCreateEnabled: !skipPostCreate,
		skipNonBlocking,
		prebuild,
		persistedFolder,
		additionalMounts: mount ? (Array.isArray(mount) ? mount : [mount]).map(mount => {
			const [, type, source, target, external] = mountRegex.exec(mount)!;
			return {
				type: type as 'bind' | 'volume',
				source,
				target,
				external: external === 'true'
			};
		}) : [],
		dotfiles: {
			repository: dotfilesRepository,
			installCommand: dotfilesInstallCommand,
			targetPath: dotfilesTargetPath,
		},
		updateRemoteUserUIDDefault,
		remoteEnv: envListToObj(addRemoteEnvs),
		secretsP,
		additionalCacheFroms: addCacheFroms,
		useBuildKit: buildkit,
		buildxPlatform: undefined,
		buildxPush: false,
		additionalLabels: [],
		buildxOutput: undefined,
		buildxCacheTo: addCacheTo,
		additionalFeatures,
		skipFeatureAutoMapping,
		skipPostAttach,
		containerSessionDataFolder,
		skipPersistingCustomizationsFromFeatures: false,
		omitConfigRemotEnvFromMetadata,
		experimentalLockfile,
		experimentalFrozenLockfile,
		omitSyntaxDirective,
		includeConfig,
		includeMergedConfig,
	};

	const result = await doProvision(options, providedIdLabels);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	await new Promise<void>((resolve, reject) => {
		process.stdout.write(JSON.stringify(result) + '\n', err => err ? reject(err) : resolve());
	});
	if (result.outcome === 'success') {
		await result.finishBackgroundTasks();
	}
	await result.dispose();
	process.exit(exitCode);
}

async function doProvision(options: ProvisionOptions, providedIdLabels: string[] | undefined) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const result = await launch(options, providedIdLabels, disposables);
		return {
			outcome: 'success' as 'success',
			dispose,
			...result,
		};
	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred setting up the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			containerId: err.containerId,
			disallowedFeatureId: err.data.disallowedFeatureId,
			didStopContainer: err.data.didStopContainer,
			learnMoreUrl: err.data.learnMoreUrl,
			dispose,
		};
	}
}

function setUpOptions(y: Argv) {
	return y.options({
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'container-data-folder': { type: 'string', description: 'Container data folder where user data inside the container will be stored.' },
		'container-system-data-folder': { type: 'string', description: 'Container system data folder where system data inside the container will be stored.' },
		'container-id': { type: 'string', required: true, description: 'Id of the container.' },
		'config': { type: 'string', description: 'devcontainer.json path.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'default-user-env-probe': { choices: ['none' as 'none', 'loginInteractiveShell' as 'loginInteractiveShell', 'interactiveShell' as 'interactiveShell', 'loginShell' as 'loginShell'], default: defaultDefaultUserEnvProbe, description: 'Default value for the devcontainer.json\'s "userEnvProbe".' },
		'skip-post-create': { type: 'boolean', default: false, description: 'Do not run onCreateCommand, updateContentCommand, postCreateCommand, postStartCommand or postAttachCommand and do not install dotfiles.' },
		'skip-non-blocking-commands': { type: 'boolean', default: false, description: 'Stop running user commands after running the command configured with waitFor or the updateContentCommand by default.' },
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'remote-env': { type: 'string', description: 'Remote environment variables of the format name=value. These will be added when executing the user commands.' },
		'dotfiles-repository': { type: 'string', description: 'URL of a dotfiles Git repository (e.g., https://github.com/owner/repository.git)' },
		'dotfiles-install-command': { type: 'string', description: 'The command to run after cloning the dotfiles repository. Defaults to run the first file of `install.sh`, `install`, `bootstrap.sh`, `bootstrap`, `setup.sh` and `setup` found in the dotfiles repository`s root folder.' },
		'dotfiles-target-path': { type: 'string', default: '~/dotfiles', description: 'The path to clone the dotfiles repository to. Defaults to `~/dotfiles`.' },
		'container-session-data-folder': { type: 'string', description: 'Folder to cache CLI data, for example userEnvProbe results' },
		'include-configuration': { type: 'boolean', default: false, description: 'Include configuration in result.' },
		'include-merged-configuration': { type: 'boolean', default: false, description: 'Include merged configuration in result.' },
	})
		.check(argv => {
			const remoteEnvs = (argv['remote-env'] && (Array.isArray(argv['remote-env']) ? argv['remote-env'] : [argv['remote-env']])) as string[] | undefined;
			if (remoteEnvs?.some(remoteEnv => !/.+=.*/.test(remoteEnv))) {
				throw new Error('Unmatched argument format: remote-env must match <name>=<value>');
			}
			return true;
		});
}

type SetUpArgs = UnpackArgv<ReturnType<typeof setUpOptions>>;

function setUpHandler(args: SetUpArgs) {
	runAsyncHandler(setUp.bind(null, args));
}

async function setUp(args: SetUpArgs) {
	const result = await doSetUp(args);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	await new Promise<void>((resolve, reject) => {
		process.stdout.write(JSON.stringify(result) + '\n', err => err ? reject(err) : resolve());
	});
	await result.dispose();
	process.exit(exitCode);
}

async function doSetUp({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'container-data-folder': containerDataFolder,
	'container-system-data-folder': containerSystemDataFolder,
	'container-id': containerId,
	config: configParam,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'default-user-env-probe': defaultUserEnvProbe,
	'skip-post-create': skipPostCreate,
	'skip-non-blocking-commands': skipNonBlocking,
	'remote-env': addRemoteEnv,
	'dotfiles-repository': dotfilesRepository,
	'dotfiles-install-command': dotfilesInstallCommand,
	'dotfiles-target-path': dotfilesTargetPath,
	'container-session-data-folder': containerSessionDataFolder,
	'include-configuration': includeConfig,
	'include-merged-configuration': includeMergedConfig,
}: SetUpArgs) {

	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const addRemoteEnvs = addRemoteEnv ? (Array.isArray(addRemoteEnv) ? addRemoteEnv as string[] : [addRemoteEnv]) : [];
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const params = await createDockerParams({
			dockerPath,
			dockerComposePath: undefined,
			containerSessionDataFolder,
			containerDataFolder,
			containerSystemDataFolder,
			workspaceFolder: undefined,
			mountWorkspaceGitRoot: false,
			configFile,
			overrideConfigFile: undefined,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
			defaultUserEnvProbe,
			removeExistingContainer: false,
			buildNoCache: false,
			expectExistingContainer: false,
			postCreateEnabled: !skipPostCreate,
			skipNonBlocking,
			prebuild: false,
			persistedFolder,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: envListToObj(addRemoteEnvs),
			additionalCacheFroms: [],
			useBuildKit: 'auto',
			buildxPlatform: undefined,
			buildxPush: false,
			additionalLabels: [],
			buildxOutput: undefined,
			buildxCacheTo: undefined,
			skipFeatureAutoMapping: false,
			skipPostAttach: false,
			skipPersistingCustomizationsFromFeatures: false,
			dotfiles: {
				repository: dotfilesRepository,
				installCommand: dotfilesInstallCommand,
				targetPath: dotfilesTargetPath,
			},
		}, disposables);

		const { common } = params;
		const { cliHost, output } = common;
		const configs = configFile && await readDevContainerConfigFile(cliHost, undefined, configFile, params.mountWorkspaceGitRoot, output, undefined, undefined);
		if (configFile && !configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile, cliHost.platform)}) not found.` });
		}

		const config0 = configs?.config || {
			raw: {},
			config: {},
			substitute: value => substitute({ platform: cliHost.platform, env: cliHost.env }, value)
		};

		const container = await inspectContainer(params, containerId);
		if (!container) {
			bailOut(common.output, 'Dev container not found.');
		}

		const config = addSubstitution(config0, config => beforeContainerSubstitute(undefined, config));

		const imageMetadata = getImageMetadataFromContainer(container, config, undefined, undefined, output).config;
		const mergedConfig = mergeConfiguration(config.config, imageMetadata);
		const containerProperties = await createContainerProperties(params, container.Id, configs?.workspaceConfig.workspaceFolder, mergedConfig.remoteUser);
		const res = await setupInContainer(common, containerProperties, config.config, mergedConfig, lifecycleCommandOriginMapFromMetadata(imageMetadata));
		return {
			outcome: 'success' as 'success',
			configuration: includeConfig ? res.updatedConfig : undefined,
			mergedConfiguration: includeMergedConfig ? res.updatedMergedConfig : undefined,
			dispose,
		};
	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred running user commands in the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			dispose,
		};
	}
}

function buildOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'workspace-folder': { type: 'string', required: true, description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'no-cache': { type: 'boolean', default: false, description: 'Builds the image with `--no-cache`.' },
		'image-name': { type: 'string', description: 'Image name.' },
		'cache-from': { type: 'string', description: 'Additional image to use as potential layer cache' },
		'cache-to': { type: 'string', description: 'A destination of buildx cache' },
		'buildkit': { choices: ['auto' as 'auto', 'never' as 'never'], default: 'auto' as 'auto', description: 'Control whether BuildKit should be used' },
		'platform': { type: 'string', description: 'Set target platforms.' },
		'push': { type: 'boolean', default: false, description: 'Push to a container registry.' },
		'label': { type: 'string', description: 'Provide key and value configuration that adds metadata to an image' },
		'output': { type: 'string', description: 'Overrides the default behavior to load built images into the local docker registry. Valid options are the same ones provided to the --output option of docker buildx build.' },
		'additional-features': { type: 'string', description: 'Additional features to apply to the dev container (JSON as per "features" section in devcontainer.json)' },
		'skip-feature-auto-mapping': { type: 'boolean', default: false, hidden: true, description: 'Temporary option for testing.' },
		'skip-persisting-customizations-from-features': { type: 'boolean', default: false, hidden: true, description: 'Do not save customizations from referenced Features as image metadata' },
		'experimental-lockfile': { type: 'boolean', default: false, hidden: true, description: 'Write lockfile' },
		'experimental-frozen-lockfile': { type: 'boolean', default: false, hidden: true, description: 'Ensure lockfile remains unchanged' },
		'omit-syntax-directive': { type: 'boolean', default: false, hidden: true, description: 'Omit Dockerfile syntax directives' },
	});
}

type BuildArgs = UnpackArgv<ReturnType<typeof buildOptions>>;

function buildHandler(args: BuildArgs) {
	runAsyncHandler(build.bind(null, args));
}

async function build(args: BuildArgs) {
	const result = await doBuild(args);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	await new Promise<void>((resolve, reject) => {
		process.stdout.write(JSON.stringify(result) + '\n', err => err ? reject(err) : resolve());
	});
	await result.dispose();
	process.exit(exitCode);
}

async function doBuild({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'workspace-folder': workspaceFolderArg,
	config: configParam,
	'log-level': logLevel,
	'log-format': logFormat,
	'no-cache': buildNoCache,
	'image-name': argImageName,
	'cache-from': addCacheFrom,
	'buildkit': buildkit,
	'platform': buildxPlatform,
	'push': buildxPush,
	'label': buildxLabel,
	'output': buildxOutput,
	'cache-to': buildxCacheTo,
	'additional-features': additionalFeaturesJson,
	'skip-feature-auto-mapping': skipFeatureAutoMapping,
	'skip-persisting-customizations-from-features': skipPersistingCustomizationsFromFeatures,
	'experimental-lockfile': experimentalLockfile,
	'experimental-frozen-lockfile': experimentalFrozenLockfile,
	'omit-syntax-directive': omitSyntaxDirective,
}: BuildArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const configFile: URI | undefined = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const overrideConfigFile: URI | undefined = /* overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : */ undefined;
		const addCacheFroms = addCacheFrom ? (Array.isArray(addCacheFrom) ? addCacheFrom as string[] : [addCacheFrom]) : [];
		const additionalFeatures = additionalFeaturesJson ? jsonc.parse(additionalFeaturesJson) as Record<string, string | boolean | Record<string, string | boolean>> : {};
		const params = await createDockerParams({
			dockerPath,
			dockerComposePath,
			containerDataFolder: undefined,
			containerSystemDataFolder: undefined,
			workspaceFolder,
			mountWorkspaceGitRoot: false,
			configFile,
			overrideConfigFile,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: /* terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : */ undefined, // TODO
			defaultUserEnvProbe: 'loginInteractiveShell',
			removeExistingContainer: false,
			buildNoCache,
			expectExistingContainer: false,
			postCreateEnabled: false,
			skipNonBlocking: false,
			prebuild: false,
			persistedFolder,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: {},
			additionalCacheFroms: addCacheFroms,
			useBuildKit: buildkit,
			buildxPlatform,
			buildxPush,
			additionalLabels: [],
			buildxOutput,
			buildxCacheTo,
			skipFeatureAutoMapping,
			skipPostAttach: true,
			skipPersistingCustomizationsFromFeatures: skipPersistingCustomizationsFromFeatures,
			dotfiles: {},
			experimentalLockfile,
			experimentalFrozenLockfile,
			omitSyntaxDirective,
		}, disposables);

		const { common, dockerComposeCLI } = params;
		const { cliHost, env, output } = common;
		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, params.mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}
		const configWithRaw = configs.config;
		const { config } = configWithRaw;
		let imageNameResult: string[] = [''];

		if (buildxOutput && buildxPush) {
			throw new ContainerError({ description: '--push true cannot be used with --output.' });
		}

		const buildParams: DockerCLIParameters = { cliHost, dockerCLI: params.dockerCLI, dockerComposeCLI, env, output, platformInfo: params.platformInfo };
		await ensureNoDisallowedFeatures(buildParams, config, additionalFeatures, undefined);

		// Support multiple use of `--image-name`
		const imageNames = (argImageName && (Array.isArray(argImageName) ? argImageName : [argImageName]) as string[]) || undefined;

		// Support multiple use of `--label`
		params.additionalLabels = (buildxLabel && (Array.isArray(buildxLabel) ? buildxLabel : [buildxLabel]) as string[]) || [];

		if (isDockerFileConfig(config)) {

			// Build the base image and extend with features etc.
			let { updatedImageName } = await buildNamedImageAndExtend(params, configWithRaw as SubstitutedConfig<DevContainerFromDockerfileConfig>, additionalFeatures, false, imageNames);

			if (imageNames) {
				imageNameResult = imageNames;
			} else {
				imageNameResult = updatedImageName;
			}
		} else if ('dockerComposeFile' in config) {

			if (buildxPlatform || buildxPush) {
				throw new ContainerError({ description: '--platform or --push not supported.' });
			}

			if (buildxOutput) {
				throw new ContainerError({ description: '--output not supported.' });
			}

			if (buildxCacheTo) {
				throw new ContainerError({ description: '--cache-to not supported.' });
			}

			const cwdEnvFile = cliHost.path.join(cliHost.cwd, '.env');
			const envFile = Array.isArray(config.dockerComposeFile) && config.dockerComposeFile.length === 0 && await cliHost.isFile(cwdEnvFile) ? cwdEnvFile : undefined;
			const composeFiles = await getDockerComposeFilePaths(cliHost, config, cliHost.env, workspaceFolder);

			// If dockerComposeFile is an array, add -f <file> in order. https://docs.docker.com/compose/extends/#multiple-compose-files
			const composeGlobalArgs = ([] as string[]).concat(...composeFiles.map(composeFile => ['-f', composeFile]));
			if (envFile) {
				composeGlobalArgs.push('--env-file', envFile);
			}
			
			const composeConfig = await readDockerComposeConfig(buildParams, composeFiles, envFile);
			const projectName = await getProjectName(params, workspace, composeFiles, composeConfig);
			const services = Object.keys(composeConfig.services || {});
			if (services.indexOf(config.service) === -1) {
				throw new Error(`Service '${config.service}' configured in devcontainer.json not found in Docker Compose configuration.`);
			}

			const versionPrefix = await readVersionPrefix(cliHost, composeFiles);
			const infoParams = { ...params, common: { ...params.common, output: makeLog(buildParams.output, LogLevel.Info) } };
			const { overrideImageName } = await buildAndExtendDockerCompose(configWithRaw as SubstitutedConfig<DevContainerFromDockerComposeConfig>, projectName, infoParams, composeFiles, envFile, composeGlobalArgs, [config.service], params.buildNoCache || false, params.common.persistedFolder, 'docker-compose.devcontainer.build', versionPrefix, additionalFeatures, false, addCacheFroms);

			const service = composeConfig.services[config.service];
			const originalImageName = overrideImageName || service.image || getDefaultImageName(await buildParams.dockerComposeCLI(), projectName, config.service);

			if (imageNames) {
				// Future improvement: Compose 2.6.0 (released 2022-05-30) added `tags` to the compose file.
				if (params.isTTY) {
					await Promise.all(imageNames.map(imageName => dockerPtyCLI(params, 'tag', originalImageName, imageName)));
				} else {
					await Promise.all(imageNames.map(imageName => dockerCLI(params, 'tag', originalImageName, imageName)));
				}
				imageNameResult = imageNames;
			} else {
				imageNameResult = originalImageName;
			}
		} else {

			if (!config.image) {
				throw new ContainerError({ description: 'No image information specified in devcontainer.json.' });
			}

			await inspectDockerImage(params, config.image, true);
			const { updatedImageName } = await extendImage(params, configWithRaw, config.image, imageNames || [], additionalFeatures, false);

			if (imageNames) {
				imageNameResult = imageNames;
			} else {
				imageNameResult = updatedImageName;
			}
		}

		return {
			outcome: 'success' as 'success',
			imageName: imageNameResult,
			dispose,
		};
	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred building the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			dispose,
		};
	}
}

function runUserCommandsOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'container-data-folder': { type: 'string', description: 'Container data folder where user data inside the container will be stored.' },
		'container-system-data-folder': { type: 'string', description: 'Container system data folder where system data inside the container will be stored.' },
		'workspace-folder': { type: 'string', description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'container-id': { type: 'string', description: 'Id of the container to run the user commands for.' },
		'id-label': { type: 'string', description: 'Id label(s) of the format name=value. If no --container-id is given the id labels will be used to look up the container. If no --id-label is given, one will be inferred from the --workspace-folder path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'default-user-env-probe': { choices: ['none' as 'none', 'loginInteractiveShell' as 'loginInteractiveShell', 'interactiveShell' as 'interactiveShell', 'loginShell' as 'loginShell'], default: defaultDefaultUserEnvProbe, description: 'Default value for the devcontainer.json\'s "userEnvProbe".' },
		'skip-non-blocking-commands': { type: 'boolean', default: false, description: 'Stop running user commands after running the command configured with waitFor or the updateContentCommand by default.' },
		prebuild: { type: 'boolean', default: false, description: 'Stop after onCreateCommand and updateContentCommand, rerunning updateContentCommand if it has run before.' },
		'stop-for-personalization': { type: 'boolean', default: false, description: 'Stop for personalization.' },
		'remote-env': { type: 'string', description: 'Remote environment variables of the format name=value. These will be added when executing the user commands.' },
		'skip-feature-auto-mapping': { type: 'boolean', default: false, hidden: true, description: 'Temporary option for testing.' },
		'skip-post-attach': { type: 'boolean', default: false, description: 'Do not run postAttachCommand.' },
		'dotfiles-repository': { type: 'string', description: 'URL of a dotfiles Git repository (e.g., https://github.com/owner/repository.git)' },
		'dotfiles-install-command': { type: 'string', description: 'The command to run after cloning the dotfiles repository. Defaults to run the first file of `install.sh`, `install`, `bootstrap.sh`, `bootstrap`, `setup.sh` and `setup` found in the dotfiles repository`s root folder.' },
		'dotfiles-target-path': { type: 'string', default: '~/dotfiles', description: 'The path to clone the dotfiles repository to. Defaults to `~/dotfiles`.' },
		'container-session-data-folder': { type: 'string', description: 'Folder to cache CLI data, for example userEnvProbe results' },
		'secrets-file': { type: 'string', description: 'Path to a json file containing secret environment variables as key-value pairs.' },
	})
		.check(argv => {
			const idLabels = (argv['id-label'] && (Array.isArray(argv['id-label']) ? argv['id-label'] : [argv['id-label']])) as string[] | undefined;
			if (idLabels?.some(idLabel => !/.+=.+/.test(idLabel))) {
				throw new Error('Unmatched argument format: id-label must match <name>=<value>');
			}
			const remoteEnvs = (argv['remote-env'] && (Array.isArray(argv['remote-env']) ? argv['remote-env'] : [argv['remote-env']])) as string[] | undefined;
			if (remoteEnvs?.some(remoteEnv => !/.+=.*/.test(remoteEnv))) {
				throw new Error('Unmatched argument format: remote-env must match <name>=<value>');
			}
			if (!argv['container-id'] && !idLabels?.length && !argv['workspace-folder']) {
				throw new Error('Missing required argument: One of --container-id, --id-label or --workspace-folder is required.');
			}
			return true;
		});
}

type RunUserCommandsArgs = UnpackArgv<ReturnType<typeof runUserCommandsOptions>>;

function runUserCommandsHandler(args: RunUserCommandsArgs) {
	runAsyncHandler(runUserCommands.bind(null, args));
}
async function runUserCommands(args: RunUserCommandsArgs) {
	const result = await doRunUserCommands(args);
	const exitCode = result.outcome === 'error' ? 1 : 0;
	await new Promise<void>((resolve, reject) => {
		process.stdout.write(JSON.stringify(result) + '\n', err => err ? reject(err) : resolve());
	});
	await result.dispose();
	process.exit(exitCode);
}

async function doRunUserCommands({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'container-data-folder': containerDataFolder,
	'container-system-data-folder': containerSystemDataFolder,
	'workspace-folder': workspaceFolderArg,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	'container-id': containerId,
	'id-label': idLabel,
	config: configParam,
	'override-config': overrideConfig,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'default-user-env-probe': defaultUserEnvProbe,
	'skip-non-blocking-commands': skipNonBlocking,
	prebuild,
	'stop-for-personalization': stopForPersonalization,
	'remote-env': addRemoteEnv,
	'skip-feature-auto-mapping': skipFeatureAutoMapping,
	'skip-post-attach': skipPostAttach,
	'dotfiles-repository': dotfilesRepository,
	'dotfiles-install-command': dotfilesInstallCommand,
	'dotfiles-target-path': dotfilesTargetPath,
	'container-session-data-folder': containerSessionDataFolder,
	'secrets-file': secretsFile,
}: RunUserCommandsArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	try {
		const workspaceFolder = workspaceFolderArg ? path.resolve(process.cwd(), workspaceFolderArg) : undefined;
		const providedIdLabels = idLabel ? Array.isArray(idLabel) ? idLabel as string[] : [idLabel] : undefined;
		const addRemoteEnvs = addRemoteEnv ? (Array.isArray(addRemoteEnv) ? addRemoteEnv as string[] : [addRemoteEnv]) : [];
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const overrideConfigFile = overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined;

		const cwd = workspaceFolder || process.cwd();
		const cliHost = await getCLIHost(cwd, loadNativeModule, logFormat === 'text');
		const secretsP = readSecretsFromFile({ secretsFile, cliHost });

		const params = await createDockerParams({
			dockerPath,
			dockerComposePath,
			containerDataFolder,
			containerSystemDataFolder,
			workspaceFolder,
			mountWorkspaceGitRoot,
			configFile,
			overrideConfigFile,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
			defaultUserEnvProbe,
			removeExistingContainer: false,
			buildNoCache: false,
			expectExistingContainer: false,
			postCreateEnabled: true,
			skipNonBlocking,
			prebuild,
			persistedFolder,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: envListToObj(addRemoteEnvs),
			additionalCacheFroms: [],
			useBuildKit: 'auto',
			buildxPlatform: undefined,
			buildxPush: false,
			additionalLabels: [],
			buildxOutput: undefined,
			buildxCacheTo: undefined,
			skipFeatureAutoMapping,
			skipPostAttach,
			skipPersistingCustomizationsFromFeatures: false,
			dotfiles: {
				repository: dotfilesRepository,
				installCommand: dotfilesInstallCommand,
				targetPath: dotfilesTargetPath,
			},
			containerSessionDataFolder,
			secretsP,
		}, disposables);

		const { common } = params;
		const { output } = common;
		const workspace = workspaceFolder ? workspaceFromPath(cliHost.path, workspaceFolder) : undefined;
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, params.mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if ((configFile || workspaceFolder || overrideConfigFile) && !configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}

		const config0 = configs?.config || {
			raw: {},
			config: {},
			substitute: value => substitute({ platform: cliHost.platform, env: cliHost.env }, value)
		};

		const { container, idLabels } = await findContainerAndIdLabels(params, containerId, providedIdLabels, workspaceFolder, configPath?.fsPath);
		if (!container) {
			bailOut(common.output, 'Dev container not found.');
		}

		const config1 = addSubstitution(config0, config => beforeContainerSubstitute(envListToObj(idLabels), config));
		const config = addSubstitution(config1, config => containerSubstitute(cliHost.platform, config1.config.configFilePath, envListToObj(container.Config.Env), config));

		const imageMetadata = getImageMetadataFromContainer(container, config, undefined, idLabels, output).config;
		const mergedConfig = mergeConfiguration(config.config, imageMetadata);
		const containerProperties = await createContainerProperties(params, container.Id, configs?.workspaceConfig.workspaceFolder, mergedConfig.remoteUser);
		const updatedConfig = containerSubstitute(cliHost.platform, config.config.configFilePath, containerProperties.env, mergedConfig);
		const remoteEnvP = probeRemoteEnv(common, containerProperties, updatedConfig);
		const result = await runLifecycleHooks(common, lifecycleCommandOriginMapFromMetadata(imageMetadata), containerProperties, updatedConfig, remoteEnvP, secretsP, stopForPersonalization);
		return {
			outcome: 'success' as 'success',
			result,
			dispose,
		};
	} catch (originalError) {
		const originalStack = originalError?.stack;
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred running user commands in the container.',
			originalError
		});
		if (originalStack) {
			console.error(originalStack);
		}
		return {
			outcome: 'error' as 'error',
			message: err.message,
			description: err.description,
			dispose,
		};
	}
}


function readConfigurationOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'workspace-folder': { type: 'string', description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'container-id': { type: 'string', description: 'Id of the container to run the user commands for.' },
		'id-label': { type: 'string', description: 'Id label(s) of the format name=value. If no --container-id is given the id labels will be used to look up the container. If no --id-label is given, one will be inferred from the --workspace-folder path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'include-features-configuration': { type: 'boolean', default: false, description: 'Include features configuration.' },
		'include-merged-configuration': { type: 'boolean', default: false, description: 'Include merged configuration.' },
		'additional-features': { type: 'string', description: 'Additional features to apply to the dev container (JSON as per "features" section in devcontainer.json)' },
		'skip-feature-auto-mapping': { type: 'boolean', default: false, hidden: true, description: 'Temporary option for testing.' },
	})
		.check(argv => {
			const idLabels = (argv['id-label'] && (Array.isArray(argv['id-label']) ? argv['id-label'] : [argv['id-label']])) as string[] | undefined;
			if (idLabels?.some(idLabel => !/.+=.+/.test(idLabel))) {
				throw new Error('Unmatched argument format: id-label must match <name>=<value>');
			}
			if (!argv['container-id'] && !idLabels?.length && !argv['workspace-folder']) {
				throw new Error('Missing required argument: One of --container-id, --id-label or --workspace-folder is required.');
			}
			return true;
		});
}

type ReadConfigurationArgs = UnpackArgv<ReturnType<typeof readConfigurationOptions>>;

function readConfigurationHandler(args: ReadConfigurationArgs) {
	runAsyncHandler(readConfiguration.bind(null, args));
}

async function readConfiguration({
	// 'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'workspace-folder': workspaceFolderArg,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	config: configParam,
	'override-config': overrideConfig,
	'container-id': containerId,
	'id-label': idLabel,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'include-features-configuration': includeFeaturesConfig,
	'include-merged-configuration': includeMergedConfig,
	'additional-features': additionalFeaturesJson,
	'skip-feature-auto-mapping': skipFeatureAutoMapping,
}: ReadConfigurationArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	let output: Log | undefined;
	try {
		const workspaceFolder = workspaceFolderArg ? path.resolve(process.cwd(), workspaceFolderArg) : undefined;
		const providedIdLabels = idLabel ? Array.isArray(idLabel) ? idLabel as string[] : [idLabel] : undefined;
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const overrideConfigFile = overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined;
		const cwd = workspaceFolder || process.cwd();
		const cliHost = await getCLIHost(cwd, loadNativeModule, logFormat === 'text');
		const extensionPath = path.join(__dirname, '..', '..');
		const sessionStart = new Date();
		const pkg = getPackageConfig();
		output = createLog({
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
		}, pkg, sessionStart, disposables);

		const workspace = workspaceFolder ? workspaceFromPath(cliHost.path, workspaceFolder) : undefined;
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if ((configFile || workspaceFolder || overrideConfigFile) && !configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}

		let configuration = configs?.config || {
			raw: {},
			config: {},
			substitute: value => substitute({ platform: cliHost.platform, env: cliHost.env }, value)
		};

		const dockerCLI = dockerPath || 'docker';
		const dockerComposeCLI = dockerComposeCLIConfig({
			exec: cliHost.exec,
			env: cliHost.env,
			output,
		}, dockerCLI, dockerComposePath || 'docker-compose');
		const params: DockerCLIParameters = {
			cliHost,
			dockerCLI,
			dockerComposeCLI,
			env: cliHost.env,
			output,
			platformInfo: {
				os: mapNodeOSToGOOS(cliHost.platform),
				arch: mapNodeArchitectureToGOARCH(cliHost.arch),
			}
		};
		const { container, idLabels } = await findContainerAndIdLabels(params, containerId, providedIdLabels, workspaceFolder, configPath?.fsPath);
		if (container) {
			configuration = addSubstitution(configuration, config => beforeContainerSubstitute(envListToObj(idLabels), config));
			configuration = addSubstitution(configuration, config => containerSubstitute(cliHost.platform, configuration.config.configFilePath, envListToObj(container.Config.Env), config));
		}

		const additionalFeatures = additionalFeaturesJson ? jsonc.parse(additionalFeaturesJson) as Record<string, string | boolean | Record<string, string | boolean>> : {};
		const needsFeaturesConfig = includeFeaturesConfig || (includeMergedConfig && !container);
		const featuresConfiguration = needsFeaturesConfig ? await readFeaturesConfig(params, pkg, configuration.config, extensionPath, skipFeatureAutoMapping, additionalFeatures) : undefined;
		let mergedConfig: MergedDevContainerConfig | undefined;
		if (includeMergedConfig) {
			let imageMetadata: ImageMetadataEntry[];
			if (container) {
				imageMetadata = getImageMetadataFromContainer(container, configuration, featuresConfiguration, idLabels, output).config;
				const substitute2: SubstituteConfig = config => containerSubstitute(cliHost.platform, configuration.config.configFilePath, envListToObj(container.Config.Env), config);
				imageMetadata = imageMetadata.map(substitute2);
			} else {
				const imageBuildInfo = await getImageBuildInfo(params, configuration);
				imageMetadata = getDevcontainerMetadata(imageBuildInfo.metadata, configuration, featuresConfiguration).config;
			}
			mergedConfig = mergeConfiguration(configuration.config, imageMetadata);
		}
		await new Promise<void>((resolve, reject) => {
			process.stdout.write(JSON.stringify({
				configuration: configuration.config,
				workspace: configs?.workspaceConfig,
				featuresConfiguration,
				mergedConfiguration: mergedConfig,
			}) + '\n', err => err ? reject(err) : resolve());
		});
	} catch (err) {
		if (output) {
			output.write(err && (err.stack || err.message) || String(err));
		} else {
			console.error(err);
		}
		await dispose();
		process.exit(1);
	}
	await dispose();
	process.exit(0);
}

function outdatedOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'workspace-folder': { type: 'string', required: true, description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text', description: 'Output format.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
	});
}

type OutdatedArgs = UnpackArgv<ReturnType<typeof outdatedOptions>>;

function outdatedHandler(args: OutdatedArgs) {
	runAsyncHandler(outdated.bind(null, args));
}

async function outdated({
	// 'user-data-folder': persistedFolder,
	'workspace-folder': workspaceFolderArg,
	config: configParam,
	'output-format': outputFormat,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
}: OutdatedArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	let output: Log | undefined;
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const cliHost = await getCLIHost(workspaceFolder, loadNativeModule, logFormat === 'text');
		const extensionPath = path.join(__dirname, '..', '..');
		const sessionStart = new Date();
		const pkg = getPackageConfig();
		output = createLog({
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : undefined,
		}, pkg, sessionStart, disposables);

		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath);
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, true, output) || undefined;
		if (!configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}

		const cacheFolder = await getCacheFolder(cliHost);
		const params = {
			extensionPath,
			cacheFolder,
			cwd: cliHost.cwd,
			output,
			env: cliHost.env,
			skipFeatureAutoMapping: false,
			platform: cliHost.platform,
		};

		const outdated = await loadVersionInfo(params, configs.config.config);
		await new Promise<void>((resolve, reject) => {
			let text;
			if (outputFormat === 'text') {
				const rows = Object.keys(outdated.features).map(key => {
					const value = outdated.features[key];
					return [ getFeatureIdWithoutVersion(key), value.current, value.wanted, value.latest ]
						.map(v => v === undefined ? '-' : v);
				});
				const header = ['Feature', 'Current', 'Wanted', 'Latest'];
				text = textTable([
					header,
					...rows,
				]);
			} else {
				text = JSON.stringify(outdated, undefined, process.stdout.isTTY ? '  ' : undefined);
			}
			process.stdout.write(text + '\n', err => err ? reject(err) : resolve());
		});
	} catch (err) {
		if (output) {
			output.write(err && (err.stack || err.message) || String(err));
		} else {
			console.error(err);
		}
		await dispose();
		process.exit(1);
	}
	await dispose();
	process.exit(0);
}

function execOptions(y: Argv) {
	return y.options({
		'user-data-folder': { type: 'string', description: 'Host path to a directory that is intended to be persisted and share state between sessions.' },
		'docker-path': { type: 'string', description: 'Docker CLI path.' },
		'docker-compose-path': { type: 'string', description: 'Docker Compose CLI path.' },
		'container-data-folder': { type: 'string', description: 'Container data folder where user data inside the container will be stored.' },
		'container-system-data-folder': { type: 'string', description: 'Container system data folder where system data inside the container will be stored.' },
		'workspace-folder': { type: 'string', description: 'Workspace folder path. The devcontainer.json will be looked up relative to this path.' },
		'mount-workspace-git-root': { type: 'boolean', default: true, description: 'Mount the workspace using its Git root.' },
		'container-id': { type: 'string', description: 'Id of the container to run the user commands for.' },
		'id-label': { type: 'string', description: 'Id label(s) of the format name=value. If no --container-id is given the id labels will be used to look up the container. If no --id-label is given, one will be inferred from the --workspace-folder path.' },
		'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
		'override-config': { type: 'string', description: 'devcontainer.json path to override any devcontainer.json in the workspace folder (or built-in configuration). This is required when there is no devcontainer.json otherwise.' },
		'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level for the --terminal-log-file. When set to trace, the log level for --log-file will also be set to trace.' },
		'log-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text' as 'text', description: 'Log format.' },
		'terminal-columns': { type: 'number', implies: ['terminal-rows'], description: 'Number of columns to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'terminal-rows': { type: 'number', implies: ['terminal-columns'], description: 'Number of rows to render the output for. This is required for some of the subprocesses to correctly render their output.' },
		'default-user-env-probe': { choices: ['none' as 'none', 'loginInteractiveShell' as 'loginInteractiveShell', 'interactiveShell' as 'interactiveShell', 'loginShell' as 'loginShell'], default: defaultDefaultUserEnvProbe, description: 'Default value for the devcontainer.json\'s "userEnvProbe".' },
		'remote-env': { type: 'string', description: 'Remote environment variables of the format name=value. These will be added when executing the user commands.' },
		'skip-feature-auto-mapping': { type: 'boolean', default: false, hidden: true, description: 'Temporary option for testing.' },
	})
		.positional('cmd', {
			type: 'string',
			description: 'Command to execute.',
			demandOption: true,
		}).positional('args', {
			type: 'string',
			array: true,
			description: 'Arguments to the command.',
			demandOption: true,
		})
		.check(argv => {
			const idLabels = (argv['id-label'] && (Array.isArray(argv['id-label']) ? argv['id-label'] : [argv['id-label']])) as string[] | undefined;
			if (idLabels?.some(idLabel => !/.+=.+/.test(idLabel))) {
				throw new Error('Unmatched argument format: id-label must match <name>=<value>');
			}
			const remoteEnvs = (argv['remote-env'] && (Array.isArray(argv['remote-env']) ? argv['remote-env'] : [argv['remote-env']])) as string[] | undefined;
			if (remoteEnvs?.some(remoteEnv => !/.+=.*/.test(remoteEnv))) {
				throw new Error('Unmatched argument format: remote-env must match <name>=<value>');
			}
			if (!argv['container-id'] && !idLabels?.length && !argv['workspace-folder']) {
				throw new Error('Missing required argument: One of --container-id, --id-label or --workspace-folder is required.');
			}
			return true;
		});
}

export type ExecArgs = UnpackArgv<ReturnType<typeof execOptions>>;

function execHandler(args: ExecArgs) {
	runAsyncHandler(exec.bind(null, args));
}

async function exec(args: ExecArgs) {
	const result = await doExec(args);
	const exitCode = typeof result.code === 'number' && (result.code || !result.signal) ? result.code :
		typeof result.signal === 'number' && result.signal > 0 ? 128 + result.signal : // 128 + signal number convention: https://tldp.org/LDP/abs/html/exitcodes.html
		typeof result.signal === 'string' && processSignals[result.signal] ? 128 + processSignals[result.signal]! : 1;
	await result.dispose();
	process.exit(exitCode);
}

export async function doExec({
	'user-data-folder': persistedFolder,
	'docker-path': dockerPath,
	'docker-compose-path': dockerComposePath,
	'container-data-folder': containerDataFolder,
	'container-system-data-folder': containerSystemDataFolder,
	'workspace-folder': workspaceFolderArg,
	'mount-workspace-git-root': mountWorkspaceGitRoot,
	'container-id': containerId,
	'id-label': idLabel,
	config: configParam,
	'override-config': overrideConfig,
	'log-level': logLevel,
	'log-format': logFormat,
	'terminal-rows': terminalRows,
	'terminal-columns': terminalColumns,
	'default-user-env-probe': defaultUserEnvProbe,
	'remote-env': addRemoteEnv,
	'skip-feature-auto-mapping': skipFeatureAutoMapping,
	_: restArgs,
}: ExecArgs & { _?: string[] }) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	let output: Log | undefined;
	const isTTY = process.stdin.isTTY && process.stdout.isTTY || logFormat === 'json'; // If stdin or stdout is a pipe, we don't want to use a PTY.
	try {
		const workspaceFolder = workspaceFolderArg ? path.resolve(process.cwd(), workspaceFolderArg) : undefined;
		const providedIdLabels = idLabel ? Array.isArray(idLabel) ? idLabel as string[] : [idLabel] : undefined;
		const addRemoteEnvs = addRemoteEnv ? (Array.isArray(addRemoteEnv) ? addRemoteEnv as string[] : [addRemoteEnv]) : [];
		const configFile = configParam ? URI.file(path.resolve(process.cwd(), configParam)) : undefined;
		const overrideConfigFile = overrideConfig ? URI.file(path.resolve(process.cwd(), overrideConfig)) : undefined;
		const params = await createDockerParams({
			dockerPath,
			dockerComposePath,
			containerDataFolder,
			containerSystemDataFolder,
			workspaceFolder,
			mountWorkspaceGitRoot,
			configFile,
			overrideConfigFile,
			logLevel: mapLogLevel(logLevel),
			logFormat,
			log: text => process.stderr.write(text),
			terminalDimensions: terminalColumns && terminalRows ? { columns: terminalColumns, rows: terminalRows } : isTTY ? { columns: process.stdout.columns, rows: process.stdout.rows } : undefined,
			onDidChangeTerminalDimensions: terminalColumns && terminalRows ? undefined : isTTY ? createStdoutResizeEmitter(disposables) : undefined,
			defaultUserEnvProbe,
			removeExistingContainer: false,
			buildNoCache: false,
			expectExistingContainer: false,
			postCreateEnabled: true,
			skipNonBlocking: false,
			prebuild: false,
			persistedFolder,
			additionalMounts: [],
			updateRemoteUserUIDDefault: 'never',
			remoteEnv: envListToObj(addRemoteEnvs),
			additionalCacheFroms: [],
			useBuildKit: 'auto',
			omitLoggerHeader: true,
			buildxPlatform: undefined,
			buildxPush: false,
			additionalLabels: [],
			buildxCacheTo: undefined,
			skipFeatureAutoMapping,
			buildxOutput: undefined,
			skipPostAttach: false,
			skipPersistingCustomizationsFromFeatures: false,
			dotfiles: {}
		}, disposables);

		const { common } = params;
		const { cliHost } = common;
		output = common.output;
		const workspace = workspaceFolder ? workspaceFromPath(cliHost.path, workspaceFolder) : undefined;
		const configPath = configFile ? configFile : workspace
			? (await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath)
				|| (overrideConfigFile ? getDefaultDevContainerConfigPath(cliHost, workspace.configFolderPath) : undefined))
			: overrideConfigFile;
		const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, params.mountWorkspaceGitRoot, output, undefined, overrideConfigFile) || undefined;
		if ((configFile || workspaceFolder || overrideConfigFile) && !configs) {
			throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
		}

		const config = configs?.config || {
			raw: {},
			config: {},
			substitute: value => substitute({ platform: cliHost.platform, env: cliHost.env }, value)
		};

		const { container, idLabels } = await findContainerAndIdLabels(params, containerId, providedIdLabels, workspaceFolder, configPath?.fsPath);
		if (!container) {
			bailOut(common.output, 'Dev container not found.');
		}
		const imageMetadata = getImageMetadataFromContainer(container, config, undefined, idLabels, output).config;
		const mergedConfig = mergeConfiguration(config.config, imageMetadata);
		const containerProperties = await createContainerProperties(params, container.Id, configs?.workspaceConfig.workspaceFolder, mergedConfig.remoteUser);
		const updatedConfig = containerSubstitute(cliHost.platform, config.config.configFilePath, containerProperties.env, mergedConfig);
		const remoteEnv = probeRemoteEnv(common, containerProperties, updatedConfig);
		const remoteCwd = containerProperties.remoteWorkspaceFolder || containerProperties.homeFolder;
		await runRemoteCommand({ ...common, output, stdin: process.stdin, ...(logFormat !== 'json' ? { stdout: process.stdout, stderr: process.stderr } : {}) }, containerProperties, restArgs || [], remoteCwd, { remoteEnv: await remoteEnv, pty: isTTY, print: 'continuous' });
		return {
			code: 0,
			dispose,
		};

	} catch (err) {
		if (!err?.code && !err?.signal) {
			if (output) {
				output.write(err?.stack || err?.message || String(err), LogLevel.Error);
			} else {
				console.error(err?.stack || err?.message || String(err));
			}
		}
		return {
			code: err?.code as number | undefined,
			signal: err?.signal as string | number | undefined,
			dispose,
		};
	}
}

function createStdoutResizeEmitter(disposables: (() => Promise<unknown> | void)[]): Event<LogDimensions> {
	const resizeListener = () => {
		emitter.fire({
			rows: process.stdout.rows,
			columns: process.stdout.columns
		});
	};
	const emitter = new NodeEventEmitter<LogDimensions>({
		on: () => process.stdout.on('resize', resizeListener),
		off: () => process.stdout.off('resize', resizeListener),
	});
	disposables.push(() => emitter.dispose());
	return emitter.event;
}

async function readSecretsFromFile(params: { output?: Log; secretsFile?: string; cliHost: CLIHost }) {
	const { secretsFile, cliHost, output } = params;
	if (!secretsFile) {
		return {};
	}

	try {
		const fileBuff = await cliHost.readFile(secretsFile);
		const parseErrors: jsonc.ParseError[] = [];
		const secrets = jsonc.parse(fileBuff.toString(), parseErrors) as Record<string, string>;
		if (parseErrors.length) {
			throw new Error('Invalid json data');
		}

		return secrets;
	}
	catch (e) {
		if (output) {
			output.write(`Failed to read/parse secrets from file '${secretsFile}'`, LogLevel.Error);
		}

		throw new ContainerError({
			description: 'Failed to read/parse secrets',
			originalError: e
		});
	}
}
