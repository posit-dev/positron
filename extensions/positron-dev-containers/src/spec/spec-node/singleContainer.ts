/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { createContainerProperties, startEventSeen, ResolverResult, getTunnelInformation, getDockerfilePath, getDockerContextPath, DockerResolverParameters, isDockerFileConfig, uriToWSLFsPath, WorkspaceConfiguration, getFolderImageName, inspectDockerImage, logUMask, SubstitutedConfig, checkDockerSupportForGPU, isBuildKitImagePolicyError } from './utils';
import { ContainerProperties, setupInContainer, ResolverProgress, ResolverParameters } from '../spec-common/injectHeadless';
import { ContainerError, toErrorText } from '../spec-common/errors';
import { ContainerDetails, listContainers, DockerCLIParameters, inspectContainers, dockerCLI, dockerPtyCLI, toPtyExecParameters, ImageDetails, toExecParameters, removeContainer } from '../spec-shutdown/dockerUtils';
import { DevContainerConfig, DevContainerFromDockerfileConfig, DevContainerFromImageConfig } from '../spec-configuration/configuration';
import { LogLevel, Log, makeLog } from '../spec-utils/log';
import { extendImage, getExtendImageBuildInfo, updateRemoteUserUID } from './containerFeatures';
import { getDevcontainerMetadata, getImageBuildInfoFromDockerfile, getImageMetadataFromContainer, ImageMetadataEntry, lifecycleCommandOriginMapFromMetadata, mergeConfiguration, MergedDevContainerConfig } from './imageMetadata';
import { ensureDockerfileHasFinalStageName, generateMountCommand } from './dockerfileUtils';

export const hostFolderLabel = 'devcontainer.local_folder'; // used to label containers created from a workspace/folder
export const configFileLabel = 'devcontainer.config_file';

export async function openDockerfileDevContainer(params: DockerResolverParameters, configWithRaw: SubstitutedConfig<DevContainerFromDockerfileConfig | DevContainerFromImageConfig>, workspaceConfig: WorkspaceConfiguration, idLabels: string[], additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>): Promise<ResolverResult> {
	const { common } = params;
	const { config } = configWithRaw;
	// let collapsedFeaturesConfig: () => Promise<CollapsedFeaturesConfig | undefined>;

	let container: ContainerDetails | undefined;
	let containerProperties: ContainerProperties | undefined;

	try {
		container = await findExistingContainer(params, idLabels);
		let imageMetadata: ImageMetadataEntry[];
		let mergedConfig: MergedDevContainerConfig;
		if (container) {
			// let _collapsedFeatureConfig: Promise<CollapsedFeaturesConfig | undefined>;
			// collapsedFeaturesConfig = async () => {
			// 	return _collapsedFeatureConfig || (_collapsedFeatureConfig = (async () => {
			// 		const allLabels = container?.Config.Labels || {};
			// 		const featuresConfig = await generateFeaturesConfig(params.common, (await createFeaturesTempFolder(params.common)), config, async () => allLabels, getContainerFeaturesFolder);
			// 		return collapseFeaturesConfig(featuresConfig);
			// 	})());
			// };
			await startExistingContainer(params, idLabels, container);
			imageMetadata = getImageMetadataFromContainer(container, configWithRaw, undefined, idLabels, common.output).config;
			mergedConfig = mergeConfiguration(config, imageMetadata);
		} else {
			const res = await buildNamedImageAndExtend(params, configWithRaw, additionalFeatures, true);
			imageMetadata = res.imageMetadata.config;
			mergedConfig = mergeConfiguration(config, imageMetadata);
			const { containerUser } = mergedConfig;
			const updatedImageName = await updateRemoteUserUID(params, mergedConfig, res.updatedImageName[0], res.imageDetails, findUserArg(config.runArgs) || containerUser);

			// collapsedFeaturesConfig = async () => res.collapsedFeaturesConfig;

			try {
				await spawnDevContainer(params, config, mergedConfig, updatedImageName, idLabels, workspaceConfig.workspaceMount, res.imageDetails, containerUser, res.labels || {});
			} finally {
				// In 'finally' because 'docker run' can fail after creating the container.
				// Trying to get it here, so we can offer 'Rebuild Container' as an action later.
				container = await findDevContainer(params, idLabels);
			}
			if (!container) {
				return bailOut(common.output, 'Dev container not found.');
			}
		}

		containerProperties = await createContainerProperties(params, container.Id, workspaceConfig.workspaceFolder, mergedConfig.remoteUser);
		return await setupContainer(container, params, containerProperties, config, mergedConfig, imageMetadata);

	} catch (e) {
		throw createSetupError(e, container, params, containerProperties, config);
	}
}

function createSetupError(originalError: any, container: ContainerDetails | undefined, params: DockerResolverParameters, containerProperties: ContainerProperties | undefined, config: DevContainerConfig | undefined): ContainerError {
	let description = 'An error occurred setting up the container.';

	if (originalError?.cmdOutput?.includes('docker: Error response from daemon: authorization denied by plugin')) {
		description = originalError.cmdOutput;
	}

	const err = originalError instanceof ContainerError ? originalError : new ContainerError({
		description,
		originalError
	});
	if (container) {
		err.manageContainer = true;
		err.params = params.common;
		err.containerId = container.Id;
		err.dockerParams = params;
	}
	if (containerProperties) {
		err.containerProperties = containerProperties;
	}
	if (config) {
		err.config = config;
	}
	return err;
}

async function setupContainer(container: ContainerDetails, params: DockerResolverParameters, containerProperties: ContainerProperties, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, mergedConfig: MergedDevContainerConfig, imageMetadata: ImageMetadataEntry[]): Promise<ResolverResult> {
	const { common } = params;
	const {
		remoteEnv: extensionHostEnv,
		updatedConfig,
		updatedMergedConfig,
	} = await setupInContainer(common, containerProperties, config, mergedConfig, lifecycleCommandOriginMapFromMetadata(imageMetadata));

	return {
		params: common,
		properties: containerProperties,
		config: updatedConfig,
		mergedConfig: updatedMergedConfig,
		resolvedAuthority: {
			extensionHostEnv,
		},
		tunnelInformation: common.isLocalContainer ? getTunnelInformation(container) : {},
		dockerParams: params,
		dockerContainerId: container.Id,
	};
}

function getDefaultName(config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, params: DockerResolverParameters) {
	return 'image' in config && config.image ? config.image : getFolderImageName(params.common);
}
export async function buildNamedImageAndExtend(params: DockerResolverParameters, configWithRaw: SubstitutedConfig<DevContainerFromDockerfileConfig | DevContainerFromImageConfig>, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>, canAddLabelsToContainer: boolean, argImageNames?: string[]): Promise<{ updatedImageName: string[]; imageMetadata: SubstitutedConfig<ImageMetadataEntry[]>; imageDetails: () => Promise<ImageDetails>; labels?: Record<string, string> }> {
	const { config } = configWithRaw;
	const imageNames = argImageNames ?? [getDefaultName(config, params)];
	params.common.progress(ResolverProgress.BuildingImage);
	if (isDockerFileConfig(config)) {
		return await buildAndExtendImage(params, configWithRaw as SubstitutedConfig<DevContainerFromDockerfileConfig>, imageNames, params.buildNoCache ?? false, additionalFeatures);
	}
	// image-based dev container - extend
	return await extendImage(params, configWithRaw, imageNames[0], argImageNames || [], additionalFeatures, canAddLabelsToContainer);
}

async function buildAndExtendImage(buildParams: DockerResolverParameters, configWithRaw: SubstitutedConfig<DevContainerFromDockerfileConfig>, baseImageNames: string[], noCache: boolean, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>) {
	const { cliHost, output } = buildParams.common;
	const { config } = configWithRaw;
	const dockerfileUri = getDockerfilePath(cliHost, config);
	const dockerfilePath = await uriToWSLFsPath(dockerfileUri, cliHost);
	if (!cliHost.isFile(dockerfilePath)) {
		throw new ContainerError({ description: `Dockerfile (${dockerfilePath}) not found.` });
	}

	let dockerfile = (await cliHost.readFile(dockerfilePath)).toString();
	const originalDockerfile = dockerfile;
	let baseName = 'dev_container_auto_added_stage_label';
	if (config.build?.target) {
		// Explictly set build target for the dev container build features on that
		baseName = config.build.target;
	} else {
		// Use the last stage in the Dockerfile
		// Find the last line that starts with "FROM" (possibly preceeded by white-space)
		const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(dockerfile, baseName);
		baseName = lastStageName;
		if (modifiedDockerfile) {
			dockerfile = modifiedDockerfile;
		}
	}

	const imageBuildInfo = await getImageBuildInfoFromDockerfile(buildParams, originalDockerfile, config.build?.args || {}, config.build?.target, configWithRaw.substitute);
	const extendImageBuildInfo = await getExtendImageBuildInfo(buildParams, configWithRaw, baseName, imageBuildInfo, undefined, additionalFeatures, false);

	let finalDockerfilePath = dockerfilePath;
	const additionalBuildArgs: string[] = [];
	if (extendImageBuildInfo?.featureBuildInfo) {
		const { featureBuildInfo } = extendImageBuildInfo;
		// We add a '# syntax' line at the start, so strip out any existing line
		const syntaxMatch = dockerfile.match(/^\s*#\s*syntax\s*=.*[\r\n]/g);
		if (syntaxMatch) {
			dockerfile = dockerfile.slice(syntaxMatch[0].length);
		}
		let finalDockerfileContent = `${featureBuildInfo.dockerfilePrefixContent}${dockerfile}\n${featureBuildInfo.dockerfileContent}`;
		finalDockerfilePath = cliHost.path.join(featureBuildInfo?.dstFolder, 'Dockerfile-with-features');
		await cliHost.writeFile(finalDockerfilePath, Buffer.from(finalDockerfileContent));

		// track additional build args to include below
		for (const buildContext in featureBuildInfo.buildKitContexts) {
			additionalBuildArgs.push('--build-context', `${buildContext}=${featureBuildInfo.buildKitContexts[buildContext]}`);
		}
		for (const buildArg in featureBuildInfo.buildArgs) {
			additionalBuildArgs.push('--build-arg', `${buildArg}=${featureBuildInfo.buildArgs[buildArg]}`);
		}

		for (const securityOpt of featureBuildInfo.securityOpts) {
			additionalBuildArgs.push('--security-opt', securityOpt);
		}
	}

	const args: string[] = [];
	if (!buildParams.buildKitVersion &&
		(buildParams.buildxPlatform || buildParams.buildxPush)) {
		throw new ContainerError({ description: '--platform or --push require BuildKit enabled.', data: { fileWithError: dockerfilePath } });
	}
	if (buildParams.buildKitVersion) {
		args.push('buildx', 'build');
		if (buildParams.buildxPlatform) {
			output.write('Setting BuildKit platform(s): ' + buildParams.buildxPlatform, LogLevel.Trace);
			args.push('--platform', buildParams.buildxPlatform);
		}
		if (buildParams.buildxPush) {
			args.push('--push');
		} else {
			if (buildParams.buildxOutput) { 
				args.push('--output', buildParams.buildxOutput);
			} else {
				args.push('--load'); // (short for --output=docker, i.e. load into normal 'docker images' collection)
			}
		}
		if (buildParams.buildxCacheTo) {
			args.push('--cache-to', buildParams.buildxCacheTo);
		}
		args.push('--build-arg', 'BUILDKIT_INLINE_CACHE=1');
	} else {
		args.push('build');
	}
	args.push('-f', finalDockerfilePath);

	baseImageNames.map(imageName => args.push('-t', imageName));

	const target = extendImageBuildInfo?.featureBuildInfo ? extendImageBuildInfo.featureBuildInfo.overrideTarget : config.build?.target;
	if (target) {
		args.push('--target', target);
	}
	if (noCache) {
		args.push('--no-cache');
		// `docker build --pull` pulls local image: https://github.com/devcontainers/cli/issues/60
		if (buildParams.buildKitVersion || !extendImageBuildInfo) {
			args.push('--pull');
		}
	} else {
		const configCacheFrom = config.build?.cacheFrom;
		if (buildParams.additionalCacheFroms.length || (configCacheFrom && (configCacheFrom === 'string' || configCacheFrom.length))) {
			await logUMask(buildParams);
		}
		buildParams.additionalCacheFroms.forEach(cacheFrom => args.push('--cache-from', cacheFrom));
		if (config.build && config.build.cacheFrom) {
			if (typeof config.build.cacheFrom === 'string') {
				args.push('--cache-from', config.build.cacheFrom);
			} else {
				for (let index = 0; index < config.build.cacheFrom.length; index++) {
					const cacheFrom = config.build.cacheFrom[index];
					args.push('--cache-from', cacheFrom);
				}
			}
		}
	}
	const buildArgs = config.build?.args;
	if (buildArgs) {
		for (const key in buildArgs) {
			args.push('--build-arg', `${key}=${buildArgs[key]}`);
		}
	}
	const buildOptions = config.build?.options;
	if (buildOptions?.length) {
		args.push(...buildOptions);
	}
	args.push(...additionalBuildArgs);
	args.push(await uriToWSLFsPath(getDockerContextPath(cliHost, config), cliHost));
	try {
		if (buildParams.isTTY) {
			const infoParams = { ...toPtyExecParameters(buildParams), output: makeLog(output, LogLevel.Info) };
			await dockerPtyCLI(infoParams, ...args);
		} else {
			const infoParams = { ...toExecParameters(buildParams), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
			await dockerCLI(infoParams, ...args);
		}
	} catch (err) {
		if (isBuildKitImagePolicyError(err)) {
			throw new ContainerError({ description: 'Could not resolve image due to policy.', originalError: err, data: { fileWithError: dockerfilePath } });
		}

		throw new ContainerError({ description: 'An error occurred building the image.', originalError: err, data: { fileWithError: dockerfilePath } });
	}

	const imageDetails = () => inspectDockerImage(buildParams, baseImageNames[0], false);

	return {
		updatedImageName: baseImageNames,
		imageMetadata: getDevcontainerMetadata(imageBuildInfo.metadata, configWithRaw, extendImageBuildInfo?.featuresConfig),
		imageDetails
	};
}

export function findUserArg(runArgs: string[] = []) {
	for (let i = runArgs.length - 1; i >= 0; i--) {
		const runArg = runArgs[i];
		if ((runArg === '-u' || runArg === '--user') && i + 1 < runArgs.length) {
			return runArgs[i + 1];
		}
		if (runArg.startsWith('-u=') || runArg.startsWith('--user=')) {
			return runArg.substr(runArg.indexOf('=') + 1);
		}
	}
	return undefined;
}

export async function findExistingContainer(params: DockerResolverParameters, labels: string[]) {
	const { common } = params;
	let container = await findDevContainer(params, labels);
	if (params.expectExistingContainer && !container) {
		throw new ContainerError({ description: 'The expected container does not exist.' });
	}
	if (container && (params.removeOnStartup === true || params.removeOnStartup === container.Id)) {
		const text = 'Removing Existing Container';
		const start = common.output.start(text);
		await removeContainer(params, container.Id);
		common.output.stop(text, start);
		container = undefined;
	}
	return container;
}

async function startExistingContainer(params: DockerResolverParameters, labels: string[], container: ContainerDetails) {
	const { common } = params;
	const start = container.State.Status !== 'running';
	if (start) {
		const starting = 'Starting container';
		const start = common.output.start(starting);
		const infoParams = { ...toExecParameters(params), output: makeLog(common.output, LogLevel.Info), print: 'continuous' as 'continuous' };
		await dockerCLI(infoParams, 'start', container.Id);
		common.output.stop(starting, start);
		let startedContainer = await findDevContainer(params, labels);
		if (!startedContainer) {
			bailOut(common.output, 'Dev container not found.');
		}
	}
	return start;
}

export async function findDevContainer(params: DockerCLIParameters | DockerResolverParameters, labels: string[]): Promise<ContainerDetails | undefined> {
	const ids = await listContainers(params, true, labels);
	const details = await inspectContainers(params, ids);
	return details.filter(container => container.State.Status !== 'removing')[0];
}

export async function extraRunArgs(common: ResolverParameters, params: DockerResolverParameters, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig) {
	const extraArguments: string[] = [];
	if (config.hostRequirements?.gpu) {
		if (await checkDockerSupportForGPU(params)) {
			common.output.write(`GPU support found, add GPU flags to docker call.`);
			extraArguments.push('--gpus', 'all');
		} else {
			if (config.hostRequirements?.gpu !== 'optional') {
				common.output.write('No GPU support found yet a GPU was required - consider marking it as "optional"', LogLevel.Warning);
			}
		}
	}
	return extraArguments;
}

export async function spawnDevContainer(params: DockerResolverParameters, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, mergedConfig: MergedDevContainerConfig, imageName: string, labels: string[], workspaceMount: string | undefined, imageDetails: () => Promise<ImageDetails>, containerUser: string | undefined, extraLabels: Record<string, string>) {
	const { common } = params;
	common.progress(ResolverProgress.StartingContainer);

	const appPort = config.appPort;
	const exposedPorts = typeof appPort === 'number' || typeof appPort === 'string' ? [appPort] : appPort || [];
	const exposed = (<string[]>[]).concat(...exposedPorts.map(port => ['-p', typeof port === 'number' ? `127.0.0.1:${port}:${port}` : port]));

	const cwdMount = workspaceMount ? ['--mount', workspaceMount] : [];

	const envObj = mergedConfig.containerEnv || {};
	const containerEnv = Object.keys(envObj)
		.reduce((args, key) => {
			args.push('-e', `${key}=${envObj[key]}`);
			return args;
		}, [] as string[]);

	const containerUserArgs = containerUser ? ['-u', containerUser] : [];

	const featureArgs: string[] = [];
	if (mergedConfig.init) {
		featureArgs.push('--init');
	}
	if (mergedConfig.privileged) {
		featureArgs.push('--privileged');
	}
	for (const cap of mergedConfig.capAdd || []) {
		featureArgs.push('--cap-add', cap);
	}
	for (const securityOpt of mergedConfig.securityOpt || []) {
		featureArgs.push('--security-opt', securityOpt);
	}

	const featureMounts = ([] as string[]).concat(
		...[
			...mergedConfig.mounts || [],
			...params.additionalMounts,
		].map(m => generateMountCommand(m))
	);

	const customEntrypoints = mergedConfig.entrypoints || [];
	const entrypoint = ['--entrypoint', '/bin/sh'];
	const cmd = ['-c', `echo Container started
trap "exit 0" 15
${customEntrypoints.join('\n')}
exec "$@"
while sleep 1 & wait $!; do :; done`, '-']; // `wait $!` allows for the `trap` to run (synchronous `sleep` would not).
	const overrideCommand = mergedConfig.overrideCommand;
	if (overrideCommand === false) {
		const details = await imageDetails();
		cmd.push(...details.Config.Entrypoint || []);
		cmd.push(...details.Config.Cmd || []);
	}

	const args = [
		'run',
		'--sig-proxy=false',
		'-a', 'STDOUT',
		'-a', 'STDERR',
		...exposed,
		...cwdMount,
		...featureMounts,
		...getLabels(labels),
		...containerEnv,
		...containerUserArgs,
		...await getPodmanArgs(params, config, mergedConfig, imageDetails),
		...(config.runArgs || []),
		...(await extraRunArgs(common, params, config) || []),
		...featureArgs,
		...entrypoint,
		...Object.keys(extraLabels).map(key => ['-l', `${key}=${extraLabels[key]}`]).flat(),
		imageName,
		...cmd
	];

	let cancel: () => void;
	const canceled = new Promise<void>((_, reject) => cancel = reject);
	const { started } = await startEventSeen(params, getLabelsAsRecord(labels), canceled, common.output, common.getLogLevel() === LogLevel.Trace);

	const text = 'Starting container';
	const start = common.output.start(text);

	const infoParams = { ...toPtyExecParameters(params), output: makeLog(params.common.output, LogLevel.Info) };
	const result = dockerPtyCLI(infoParams, ...args);
	result.then(cancel!, cancel!);

	await started;
	common.output.stop(text, start);
}

async function getPodmanArgs(params: DockerResolverParameters, config: DevContainerFromDockerfileConfig | DevContainerFromImageConfig, mergedConfig: MergedDevContainerConfig, imageDetails: () => Promise<ImageDetails>): Promise<string[]> {
	if (params.isPodman && params.common.cliHost.platform === 'linux') {
		const args = ['--security-opt', 'label=disable'];
		const hasIdMapping = (config.runArgs || []).some(arg => /--[ug]idmap(=|$)/.test(arg));
		if (!hasIdMapping) {
			const remoteUser = mergedConfig.remoteUser || findUserArg(config.runArgs) || (await imageDetails()).Config.User || 'root';
			if (remoteUser !== 'root' && remoteUser !== '0') {
				args.push('--userns=keep-id');
			}
		}
		return args;
	}
	return [];
}

function getLabels(labels: string[]): string[] {
	let result: string[] = [];
	labels.forEach(each => result.push('-l', each));
	return result;
}

function getLabelsAsRecord(labels: string[]): Record<string, string> {
	let result: Record<string, string> = {};
	labels.forEach(each => {
		let pair = each.split('=');
		result[pair[0]] = pair[1];
	});
	return result;
}

export function bailOut(output: Log, message: string): never {
	output.write(toErrorText(message));
	throw new Error(message);
}
