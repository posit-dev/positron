/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as yaml from 'js-yaml';
import * as shellQuote from 'shell-quote';

import { createContainerProperties, startEventSeen, ResolverResult, getTunnelInformation, DockerResolverParameters, inspectDockerImage, getEmptyContextFolder, getFolderImageName, SubstitutedConfig, checkDockerSupportForGPU, isBuildKitImagePolicyError } from './utils';
import { ContainerProperties, setupInContainer, ResolverProgress } from '../spec-common/injectHeadless';
import { ContainerError } from '../spec-common/errors';
import { Workspace } from '../spec-utils/workspaces';
import { equalPaths, parseVersion, isEarlierVersion, CLIHost } from '../spec-common/commonUtils';
import { ContainerDetails, inspectContainer, listContainers, DockerCLIParameters, dockerComposeCLI, dockerComposePtyCLI, PartialExecParameters, DockerComposeCLI, ImageDetails, toExecParameters, toPtyExecParameters, removeContainer } from '../spec-shutdown/dockerUtils';
import { DevContainerFromDockerComposeConfig, getDockerComposeFilePaths } from '../spec-configuration/configuration';
import { Log, LogLevel, makeLog, terminalEscapeSequences } from '../spec-utils/log';
import { getExtendImageBuildInfo, updateRemoteUserUID } from './containerFeatures';
import { Mount, parseMount } from '../spec-configuration/containerFeaturesConfiguration';
import path from 'path';
import { getDevcontainerMetadata, getImageBuildInfoFromDockerfile, getImageBuildInfoFromImage, getImageMetadataFromContainer, ImageBuildInfo, lifecycleCommandOriginMapFromMetadata, mergeConfiguration, MergedDevContainerConfig } from './imageMetadata';
import { ensureDockerfileHasFinalStageName } from './dockerfileUtils';
import { randomUUID } from 'crypto';

const projectLabel = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';

export async function openDockerComposeDevContainer(params: DockerResolverParameters, workspace: Workspace, config: SubstitutedConfig<DevContainerFromDockerComposeConfig>, idLabels: string[], additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>): Promise<ResolverResult> {
	const { common, dockerCLI, dockerComposeCLI } = params;
	const { cliHost, env, output } = common;
	const buildParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI, env, output, platformInfo: params.platformInfo };
	return _openDockerComposeDevContainer(params, buildParams, workspace, config, getRemoteWorkspaceFolder(config.config), idLabels, additionalFeatures);
}

async function _openDockerComposeDevContainer(params: DockerResolverParameters, buildParams: DockerCLIParameters, workspace: Workspace, configWithRaw: SubstitutedConfig<DevContainerFromDockerComposeConfig>, remoteWorkspaceFolder: string, idLabels: string[], additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>): Promise<ResolverResult> {
	const { common } = params;
	const { cliHost: buildCLIHost } = buildParams;
	const { config } = configWithRaw;

	let container: ContainerDetails | undefined;
	let containerProperties: ContainerProperties | undefined;
	try {

		const composeFiles = await getDockerComposeFilePaths(buildCLIHost, config, buildCLIHost.env, buildCLIHost.cwd);
		const cwdEnvFile = buildCLIHost.path.join(buildCLIHost.cwd, '.env');
		const envFile = Array.isArray(config.dockerComposeFile) && config.dockerComposeFile.length === 0 && await buildCLIHost.isFile(cwdEnvFile) ? cwdEnvFile : undefined;
		const composeConfig = await readDockerComposeConfig(buildParams, composeFiles, envFile);
		const projectName = await getProjectName(buildParams, workspace, composeFiles, composeConfig);
		const containerId = await findComposeContainer(params, projectName, config.service);
		if (params.expectExistingContainer && !containerId) {
			throw new ContainerError({ description: 'The expected container does not exist.' });
		}
		container = containerId ? await inspectContainer(params, containerId) : undefined;

		if (container && (params.removeOnStartup === true || params.removeOnStartup === container.Id)) {
			const text = 'Removing existing container.';
			const start = common.output.start(text);
			await removeContainer(params, container.Id);
			common.output.stop(text, start);
			container = undefined;
		}

		// let collapsedFeaturesConfig: CollapsedFeaturesConfig | undefined;
		if (!container || container.State.Status !== 'running') {
			const res = await startContainer(params, buildParams, configWithRaw, projectName, composeFiles, envFile, composeConfig, container, idLabels, additionalFeatures);
			container = await inspectContainer(params, res.containerId);
			// 	collapsedFeaturesConfig = res.collapsedFeaturesConfig;
			// } else {
			// 	const labels = container.Config.Labels || {};
			// 	const featuresConfig = await generateFeaturesConfig(params.common, (await createFeaturesTempFolder(params.common)), config, async () => labels, getContainerFeaturesFolder);
			// 	collapsedFeaturesConfig = collapseFeaturesConfig(featuresConfig);
		}

		const imageMetadata = getImageMetadataFromContainer(container, configWithRaw, undefined, idLabels, common.output).config;
		const mergedConfig = mergeConfiguration(configWithRaw.config, imageMetadata);
		containerProperties = await createContainerProperties(params, container.Id, remoteWorkspaceFolder, mergedConfig.remoteUser);

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
			composeProjectName: projectName,
		};

	} catch (originalError) {
		const err = originalError instanceof ContainerError ? originalError : new ContainerError({
			description: 'An error occurred setting up the container.',
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
		err.config = config;
		throw err;
	}
}

export function getRemoteWorkspaceFolder(config: DevContainerFromDockerComposeConfig) {
	return config.workspaceFolder || '/';
}

// exported for testing
export function getBuildInfoForService(composeService: any, cliHostPath: typeof path, localComposeFiles: string[]) {
	// composeService should taken from readDockerComposeConfig
	// the 'build' property can be a string or an object (https://docs.docker.com/compose/compose-file/build/#build-definition)

	const image = composeService.image as string | undefined;
	const composeBuild = composeService.build;
	if (!composeBuild) {
		return {
			image
		};
	}
	if (typeof (composeBuild) === 'string') {
		return {
			image,
			build: {
				context: composeBuild,
				dockerfilePath: 'Dockerfile'
			}
		};
	}
	return {
		image,
		build: {
			dockerfilePath: (composeBuild.dockerfile as string | undefined) ?? 'Dockerfile',
			context: (composeBuild.context as string | undefined) ?? cliHostPath.dirname(localComposeFiles[0]),
			target: composeBuild.target as string | undefined,
			args: composeBuild.args as Record<string, string> | undefined,
		}
	};
}

export async function buildAndExtendDockerCompose(configWithRaw: SubstitutedConfig<DevContainerFromDockerComposeConfig>, projectName: string, params: DockerResolverParameters, localComposeFiles: string[], envFile: string | undefined, composeGlobalArgs: string[], runServices: string[], noCache: boolean, overrideFilePath: string, overrideFilePrefix: string, versionPrefix: string, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>, canAddLabelsToContainer: boolean, additionalCacheFroms?: string[], noBuild?: boolean) {

	const { common, dockerCLI, dockerComposeCLI: dockerComposeCLIFunc } = params;
	const { cliHost, env, output } = common;
	const { config } = configWithRaw;

	const cliParams: DockerCLIParameters = { cliHost, dockerCLI, dockerComposeCLI: dockerComposeCLIFunc, env, output, platformInfo: params.platformInfo };
	const composeConfig = await readDockerComposeConfig(cliParams, localComposeFiles, envFile);
	const composeService = composeConfig.services[config.service];

	// determine base imageName for generated features build stage(s)
	let baseName = 'dev_container_auto_added_stage_label';
	let dockerfile: string | undefined;
	let imageBuildInfo: ImageBuildInfo;
	const serviceInfo = getBuildInfoForService(composeService, cliHost.path, localComposeFiles);
	if (serviceInfo.build) {
		const { context, dockerfilePath, target } = serviceInfo.build;
		const resolvedDockerfilePath = cliHost.path.isAbsolute(dockerfilePath) ? dockerfilePath : path.resolve(context, dockerfilePath);
		const originalDockerfile = (await cliHost.readFile(resolvedDockerfilePath)).toString();
		dockerfile = originalDockerfile;
		if (target) {
			// Explictly set build target for the dev container build features on that
			baseName = target;
		} else {
			// Use the last stage in the Dockerfile
			// Find the last line that starts with "FROM" (possibly preceeded by white-space)
			const { lastStageName, modifiedDockerfile } = ensureDockerfileHasFinalStageName(originalDockerfile, baseName);
			baseName = lastStageName;
			if (modifiedDockerfile) {
				dockerfile = modifiedDockerfile;
			}
		}
		imageBuildInfo = await getImageBuildInfoFromDockerfile(params, originalDockerfile, serviceInfo.build?.args || {}, serviceInfo.build?.target, configWithRaw.substitute);
	} else {
		imageBuildInfo = await getImageBuildInfoFromImage(params, composeService.image, configWithRaw.substitute);
	}

	// determine whether we need to extend with features
	const version = parseVersion((await params.dockerComposeCLI()).version);
	const supportsAdditionalBuildContexts = !params.isPodman && version && !isEarlierVersion(version, [2, 17, 0]);
	const optionalBuildKitParams = supportsAdditionalBuildContexts ? params : { ...params, buildKitVersion: undefined };
	const extendImageBuildInfo = await getExtendImageBuildInfo(optionalBuildKitParams, configWithRaw, baseName, imageBuildInfo, composeService.user, additionalFeatures, canAddLabelsToContainer);

	let overrideImageName: string | undefined;
	let buildOverrideContent = '';
	if (extendImageBuildInfo?.featureBuildInfo) {
		// Avoid retagging a previously pulled image.
		if (!serviceInfo.build) {
			overrideImageName = getFolderImageName(common);
			buildOverrideContent += `    image: ${overrideImageName}\n`;
		}
		// Create overridden Dockerfile and generate docker-compose build override content
		buildOverrideContent += '    build:\n';
		if (!dockerfile) {
			dockerfile = `FROM ${composeService.image} AS ${baseName}\n`;
		}
		const { featureBuildInfo } = extendImageBuildInfo;
		// We add a '# syntax' line at the start, so strip out any existing line
		const syntaxMatch = dockerfile.match(/^\s*#\s*syntax\s*=.*[\r\n]/g);
		if (syntaxMatch) {
			dockerfile = dockerfile.slice(syntaxMatch[0].length);
		}
		let finalDockerfileContent = `${featureBuildInfo.dockerfilePrefixContent}${dockerfile}\n${featureBuildInfo.dockerfileContent}`;
		const finalDockerfilePath = cliHost.path.join(featureBuildInfo?.dstFolder, 'Dockerfile-with-features');
		await cliHost.writeFile(finalDockerfilePath, Buffer.from(finalDockerfileContent));
		buildOverrideContent += `      dockerfile: ${finalDockerfilePath}\n`;
		if (serviceInfo.build?.target) {
			// Replace target. (Only when set because it is only supported with Docker Compose file version 3.4 and later.)
			buildOverrideContent += `      target: ${featureBuildInfo.overrideTarget}\n`;
		}

		if (!serviceInfo.build?.context) {
			// need to supply a context as we don't have one inherited
			const emptyDir = getEmptyContextFolder(common);
			await cliHost.mkdirp(emptyDir);
			buildOverrideContent += `      context: ${emptyDir}\n`;
		}
		// track additional build args to include
		if (Object.keys(featureBuildInfo.buildArgs).length > 0 || params.buildKitVersion) {
			buildOverrideContent += '      args:\n';
			if (params.buildKitVersion) {
				buildOverrideContent += '        - BUILDKIT_INLINE_CACHE=1\n';
			}
			for (const buildArg in featureBuildInfo.buildArgs) {
				buildOverrideContent += `        - ${buildArg}=${featureBuildInfo.buildArgs[buildArg]}\n`;
			}
		}

		if (Object.keys(featureBuildInfo.buildKitContexts).length > 0) {
			buildOverrideContent += '      additional_contexts:\n';
			for (const buildKitContext in featureBuildInfo.buildKitContexts) {
				buildOverrideContent += `        - ${buildKitContext}=${featureBuildInfo.buildKitContexts[buildKitContext]}\n`;
			}
		}
	}

	// Generate the docker-compose override and build
	const args = ['--project-name', projectName, ...composeGlobalArgs];
	const additionalComposeOverrideFiles: string[] = [];
	if (additionalCacheFroms && additionalCacheFroms.length > 0 || buildOverrideContent) {
		const composeFolder = cliHost.path.join(overrideFilePath, 'docker-compose');
		await cliHost.mkdirp(composeFolder);
		const composeOverrideFile = cliHost.path.join(composeFolder, `${overrideFilePrefix}-${Date.now()}.yml`);
		const cacheFromOverrideContent = (additionalCacheFroms && additionalCacheFroms.length > 0) ? `      cache_from:\n${additionalCacheFroms.map(cacheFrom => `        - ${cacheFrom}\n`).join('\n')}` : '';
		const composeOverrideContent = `${versionPrefix}services:
  ${config.service}:
${buildOverrideContent?.trimEnd()}
${cacheFromOverrideContent}
`;
		output.write(`Docker Compose override file for building image:\n${composeOverrideContent}`);
		await cliHost.writeFile(composeOverrideFile, Buffer.from(composeOverrideContent));
		additionalComposeOverrideFiles.push(composeOverrideFile);
		args.push('-f', composeOverrideFile);
	}

	if (!noBuild) {
		args.push('build');
		if (noCache) {
			args.push('--no-cache');
			// `docker build --pull` pulls local image: https://github.com/devcontainers/cli/issues/60
			if (!extendImageBuildInfo) {
				args.push('--pull');
			}
		}
		if (runServices.length) {
			args.push(...runServices);
			if (runServices.indexOf(config.service) === -1) {
				args.push(config.service);
			}
		}
		try {
			if (params.isTTY) {
				const infoParams = { ...toPtyExecParameters(params, await dockerComposeCLIFunc()), output: makeLog(output, LogLevel.Info) };
				await dockerComposePtyCLI(infoParams, ...args);
			} else {
				const infoParams = { ...toExecParameters(params, await dockerComposeCLIFunc()), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
				await dockerComposeCLI(infoParams, ...args);
			}
		} catch (err) {
			if (isBuildKitImagePolicyError(err)) {
				throw new ContainerError({ description: 'Could not resolve image due to policy.', originalError: err, data: { fileWithError: localComposeFiles[0] } });
			}

			throw err instanceof ContainerError ? err : new ContainerError({ description: 'An error occurred building the Docker Compose images.', originalError: err, data: { fileWithError: localComposeFiles[0] } });
		}
	}

	return {
		imageMetadata: getDevcontainerMetadata(imageBuildInfo.metadata, configWithRaw, extendImageBuildInfo?.featuresConfig),
		additionalComposeOverrideFiles,
		overrideImageName,
		labels: extendImageBuildInfo?.labels,
	};
}

async function checkForPersistedFile(cliHost: CLIHost, output: Log, files: string[], prefix: string) {
	const file = files.find((f) => f.indexOf(prefix) > -1);
	if (file) {
		const composeFileExists = await cliHost.isFile(file);

		if (composeFileExists) {
			output.write(`Restoring ${file} from persisted storage`);
			return {
				foundLabel: true,
				fileExists: true,
				file
			};
		} else {
			output.write(`Expected ${file} to exist, but it did not`, LogLevel.Error);
			return {
				foundLabel: true,
				fileExists: false,
				file
			};
		}
	} else {
		output.write(`Expected to find a docker-compose file prefixed with ${prefix}, but did not.`, LogLevel.Error);
	}
	return {
		foundLabel: false
	};
}

async function startContainer(params: DockerResolverParameters, buildParams: DockerCLIParameters, configWithRaw: SubstitutedConfig<DevContainerFromDockerComposeConfig>, projectName: string, composeFiles: string[], envFile: string | undefined, composeConfig: any, container: ContainerDetails | undefined, idLabels: string[], additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>) {
	const { common } = params;
	const { persistedFolder, output } = common;
	const { cliHost: buildCLIHost } = buildParams;
	const { config } = configWithRaw;
	const featuresBuildOverrideFilePrefix = 'docker-compose.devcontainer.build';
	const featuresStartOverrideFilePrefix = 'docker-compose.devcontainer.containerFeatures';

	common.progress(ResolverProgress.StartingContainer);

	// If dockerComposeFile is an array, add -f <file> in order. https://docs.docker.com/compose/extends/#multiple-compose-files
	const composeGlobalArgs = ([] as string[]).concat(...composeFiles.map(composeFile => ['-f', composeFile]));
	if (envFile) {
		composeGlobalArgs.push('--env-file', envFile);
	}

	const infoOutput = makeLog(buildParams.output, LogLevel.Info);
	const services = Object.keys(composeConfig.services || {});
	if (services.indexOf(config.service) === -1) {
		throw new ContainerError({ description: `Service '${config.service}' configured in devcontainer.json not found in Docker Compose configuration.`, data: { fileWithError: composeFiles[0] } });
	}

	let cancel: () => void;
	const canceled = new Promise<void>((_, reject) => cancel = reject);
	const { started } = await startEventSeen(params, { [projectLabel]: projectName, [serviceLabel]: config.service }, canceled, common.output, common.getLogLevel() === LogLevel.Trace); // await getEvents, but only assign started.

	const service = composeConfig.services[config.service];
	const originalImageName = service.image || getDefaultImageName(await buildParams.dockerComposeCLI(), projectName, config.service);

	// Try to restore the 'third' docker-compose file and featuresConfig from persisted storage.
	// This file may have been generated upon a Codespace creation.
	const labels = container?.Config?.Labels;
	output.write(`PersistedPath=${persistedFolder}, ContainerHasLabels=${!!labels}`);

	let didRestoreFromPersistedShare = false;
	if (container) {
		if (labels) {
			// update args for `docker-compose up` to use cached overrides
			const configFiles = labels['com.docker.compose.project.config_files'];
			output.write(`Container was created with these config files: ${configFiles}`);

			// Parse out the full name of the 'containerFeatures' configFile
			const files = configFiles?.split(',') ?? [];
			const persistedBuildFile = await checkForPersistedFile(buildCLIHost, output, files, featuresBuildOverrideFilePrefix);
			const persistedStartFile = await checkForPersistedFile(buildCLIHost, output, files, featuresStartOverrideFilePrefix);
			if ((persistedBuildFile.fileExists || !persistedBuildFile.foundLabel) // require build file if in label
				&& persistedStartFile.fileExists // always require start file
			) {
				didRestoreFromPersistedShare = true;
				if (persistedBuildFile.fileExists) {
					composeGlobalArgs.push('-f', persistedBuildFile.file);
				}
				if (persistedStartFile.fileExists) {
					composeGlobalArgs.push('-f', persistedStartFile.file);
				}
			}
		}
	}

	if (!container || !didRestoreFromPersistedShare) {
		const noBuild = !!container; //if we have an existing container, just recreate override files but skip the build

		const versionPrefix = await readVersionPrefix(buildCLIHost, composeFiles);
		const infoParams = { ...params, common: { ...params.common, output: infoOutput } };
		const { imageMetadata, additionalComposeOverrideFiles, overrideImageName, labels } = await buildAndExtendDockerCompose(configWithRaw, projectName, infoParams, composeFiles, envFile, composeGlobalArgs, config.runServices ?? [], params.buildNoCache ?? false, persistedFolder, featuresBuildOverrideFilePrefix, versionPrefix, additionalFeatures, true, params.additionalCacheFroms, noBuild);
		additionalComposeOverrideFiles.forEach(overrideFilePath => composeGlobalArgs.push('-f', overrideFilePath));

		const currentImageName = overrideImageName || originalImageName;
		let cache: Promise<ImageDetails> | undefined;
		const imageDetails = () => cache || (cache = inspectDockerImage(params, currentImageName, true));
		const mergedConfig = mergeConfiguration(config, imageMetadata.config);
		const updatedImageName = noBuild ? currentImageName : await updateRemoteUserUID(params, mergedConfig, currentImageName, imageDetails, service.user);

		// Save override docker-compose file to disk.
		// Persisted folder is a path that will be maintained between sessions
		// Note: As a fallback, persistedFolder is set to the build's tmpDir() directory
		const additionalLabels = labels ? idLabels.concat(Object.keys(labels).map(key => `${key}=${labels[key]}`)) : idLabels;
		const overrideFilePath = await writeFeaturesComposeOverrideFile(updatedImageName, currentImageName, mergedConfig, config, versionPrefix, imageDetails, service, additionalLabels, params.additionalMounts, persistedFolder, featuresStartOverrideFilePrefix, buildCLIHost, params, output);

		if (overrideFilePath) {
			// Add file path to override file as parameter
			composeGlobalArgs.push('-f', overrideFilePath);
		}
	}

	const args = ['--project-name', projectName, ...composeGlobalArgs];
	args.push('up', '-d');
	if (container || params.expectExistingContainer) {
		args.push('--no-recreate');
	}
	if (config.runServices && config.runServices.length) {
		args.push(...config.runServices);
		if (config.runServices.indexOf(config.service) === -1) {
			args.push(config.service);
		}
	}
	try {
		if (params.isTTY) {
			await dockerComposePtyCLI({ ...buildParams, output: infoOutput }, ...args);
		} else {
			await dockerComposeCLI({ ...buildParams, output: infoOutput }, ...args);
		}
	} catch (err) {
		cancel!();

		let description = 'An error occurred starting Docker Compose up.';
		if (err?.cmdOutput?.includes('Cannot create container for service app: authorization denied by plugin')) {
			description = err.cmdOutput;
		}

		throw new ContainerError({ description, originalError: err, data: { fileWithError: composeFiles[0] } });
	}

	await started;
	return {
		containerId: (await findComposeContainer(params, projectName, config.service))!,
	};
}

export async function readVersionPrefix(cliHost: CLIHost, composeFiles: string[]) {
	if (!composeFiles.length) {
		return '';
	}
	const firstComposeFile = (await cliHost.readFile(composeFiles[0])).toString();
	const version = (/^\s*(version:.*)$/m.exec(firstComposeFile) || [])[1];
	return version ? `${version}\n\n` : '';
}

export function getDefaultImageName(dockerComposeCLI: DockerComposeCLI, projectName: string, serviceName: string) {
	const version = parseVersion(dockerComposeCLI.version);
	const separator = version && isEarlierVersion(version, [2, 8, 0]) ? '_' : '-';
	return `${projectName}${separator}${serviceName}`;
}

async function writeFeaturesComposeOverrideFile(
	updatedImageName: string,
	originalImageName: string,
	mergedConfig: MergedDevContainerConfig,
	config: DevContainerFromDockerComposeConfig,
	versionPrefix: string,
	imageDetails: () => Promise<ImageDetails>,
	service: any,
	additionalLabels: string[],
	additionalMounts: Mount[],
	overrideFilePath: string,
	overrideFilePrefix: string,
	buildCLIHost: CLIHost,
	params: DockerResolverParameters,
	output: Log,
) {
	const composeOverrideContent = await generateFeaturesComposeOverrideContent(updatedImageName, originalImageName, mergedConfig, config, versionPrefix, imageDetails, service, additionalLabels, additionalMounts, params);
	const overrideFileHasContents = !!composeOverrideContent && composeOverrideContent.length > 0 && composeOverrideContent.trim() !== '';
	if (overrideFileHasContents) {
		output.write(`Docker Compose override file for creating container:\n${composeOverrideContent}`);

		const fileName = `${overrideFilePrefix}-${Date.now()}-${randomUUID()}.yml`;
		const composeFolder = buildCLIHost.path.join(overrideFilePath, 'docker-compose');
		const composeOverrideFile = buildCLIHost.path.join(composeFolder, fileName);
		output.write(`Writing ${fileName} to ${composeFolder}`);
		await buildCLIHost.mkdirp(composeFolder);
		await buildCLIHost.writeFile(composeOverrideFile, Buffer.from(composeOverrideContent));

		return composeOverrideFile;
	} else {
		output.write('Override file was generated, but was empty and thus not persisted or included in the docker-compose arguments.');
		return undefined;
	}
}

async function generateFeaturesComposeOverrideContent(
	updatedImageName: string,
	originalImageName: string,
	mergedConfig: MergedDevContainerConfig,
	config: DevContainerFromDockerComposeConfig,
	versionPrefix: string,
	imageDetails: () => Promise<ImageDetails>,
	service: any,
	additionalLabels: string[],
	additionalMounts: Mount[],
	params: DockerResolverParameters,
) {
	const overrideImage = updatedImageName !== originalImageName;

	const user = mergedConfig.containerUser;
	const env = mergedConfig.containerEnv || {};
	const capAdd = mergedConfig.capAdd || [];
	const securityOpts = mergedConfig.securityOpt || [];
	const mounts = [
		...mergedConfig.mounts || [],
		...additionalMounts,
	].map(m => typeof m === 'string' ? parseMount(m) : m);
	const namedVolumeMounts = mounts.filter(m => m.type === 'volume' && m.source);
	const customEntrypoints = mergedConfig.entrypoints || [];
	const composeEntrypoint: string[] | undefined = typeof service.entrypoint === 'string' ? shellQuote.parse(service.entrypoint) : service.entrypoint;
	const composeCommand: string[] | undefined = typeof service.command === 'string' ? shellQuote.parse(service.command) : service.command;
	const { overrideCommand } = mergedConfig;
	const userEntrypoint = overrideCommand ? [] : composeEntrypoint /* $ already escaped. */
		|| ((await imageDetails()).Config.Entrypoint || []).map(c => c.replace(/\$/g, '$$$$')); // $ > $$ to escape docker-compose.yml's interpolation.
	const userCommand = overrideCommand ? [] : composeCommand /* $ already escaped. */
		|| (composeEntrypoint ? [/* Ignore image CMD per docker-compose.yml spec. */] : ((await imageDetails()).Config.Cmd || []).map(c => c.replace(/\$/g, '$$$$'))); // $ > $$ to escape docker-compose.yml's interpolation.

	const hasGpuRequirement = config.hostRequirements?.gpu;
	const addGpuCapability = hasGpuRequirement && await checkDockerSupportForGPU(params);
	if (hasGpuRequirement && hasGpuRequirement !== 'optional' && !addGpuCapability) {
		params.common.output.write('No GPU support found yet a GPU was required - consider marking it as "optional"', LogLevel.Warning);
	}
	const gpuResources = addGpuCapability ? `
    deploy:
      resources:
        reservations:
          devices:
            - capabilities: [gpu]` : '';

	return `${versionPrefix}services:
  '${config.service}':${overrideImage ? `
    image: ${updatedImageName}` : ''}
    entrypoint: ["/bin/sh", "-c", "echo Container started\\n
trap \\"exit 0\\" 15\\n
${customEntrypoints.join('\\n\n')}\\n
exec \\"$$@\\"\\n
while sleep 1 & wait $$!; do :; done", "-"${userEntrypoint.map(a => `, ${JSON.stringify(a)}`).join('')}]${userCommand !== composeCommand ? `
    command: ${JSON.stringify(userCommand)}` : ''}${mergedConfig.init ? `
    init: true` : ''}${user ? `
    user: ${user}` : ''}${Object.keys(env).length ? `
    environment:${Object.keys(env).map(key => `
      - '${key}=${String(env[key]).replace(/\n/g, '\\n').replace(/\$/g, '$$$$').replace(/'/g, '\'\'')}'`).join('')}` : ''}${mergedConfig.privileged ? `
    privileged: true` : ''}${capAdd.length ? `
    cap_add:${capAdd.map(cap => `
      - ${cap}`).join('')}` : ''}${securityOpts.length ? `
    security_opt:${securityOpts.map(securityOpt => `
      - ${securityOpt}`).join('')}` : ''}${additionalLabels.length ? `
    labels:${additionalLabels.map(label => `
      - '${label.replace(/\$/g, '$$$$').replace(/'/g, '\'\'')}'`).join('')}` : ''}${mounts.length ? `
    volumes:${mounts.map(m => `
      - ${convertMountToVolume(m)}`).join('')}` : ''}${gpuResources}${namedVolumeMounts.length ? `
volumes:${namedVolumeMounts.map(m => `
  ${convertMountToVolumeTopLevelElement(m)}`).join('')}` : ''}
`;
}

export async function readDockerComposeConfig(params: DockerCLIParameters, composeFiles: string[], envFile: string | undefined) {
	try {
		const composeGlobalArgs = ([] as string[]).concat(...composeFiles.map(composeFile => ['-f', composeFile]));
		if (envFile) {
			composeGlobalArgs.push('--env-file', envFile);
		}
		const composeCLI = await params.dockerComposeCLI();
		if ((parseVersion(composeCLI.version) || [])[0] >= 2) {
			composeGlobalArgs.push('--profile', '*');
		}
		try {
			const partial = toExecParameters(params, 'dockerComposeCLI' in params ? await params.dockerComposeCLI() : undefined);
			const { stdout } = await dockerComposeCLI({
				...partial,
				output: makeLog(params.output, LogLevel.Info),
				print: 'onerror'
			}, ...composeGlobalArgs, 'config');
			const stdoutStr = stdout.toString();
			params.output.write(stdoutStr);
			return yaml.load(stdoutStr) || {} as any;
		} catch (err) {
			if (!Buffer.isBuffer(err?.stderr) || err?.stderr.toString().indexOf('UnicodeEncodeError') === -1) {
				throw err;
			}
			// Upstream issues. https://github.com/microsoft/vscode-remote-release/issues/5308
			if (params.cliHost.platform === 'win32') {
				const { cmdOutput } = await dockerComposePtyCLI({
					...params,
					output: makeLog({
						event: params.output.event,
						dimensions: {
							columns: 999999,
							rows: 1,
						},
					}, LogLevel.Info),
				}, ...composeGlobalArgs, 'config');
				return yaml.load(cmdOutput.replace(terminalEscapeSequences, '')) || {} as any;
			}
			const { stdout } = await dockerComposeCLI({
				...params,
				env: {
					...params.env,
					LANG: 'en_US.UTF-8',
					LC_CTYPE: 'en_US.UTF-8',
				}
			}, ...composeGlobalArgs, 'config');
			const stdoutStr = stdout.toString();
			params.output.write(stdoutStr);
			return yaml.load(stdoutStr) || {} as any;
		}
	} catch (err) {
		throw err instanceof ContainerError ? err : new ContainerError({ description: 'An error occurred retrieving the Docker Compose configuration.', originalError: err, data: { fileWithError: composeFiles[0] } });
	}
}

export async function findComposeContainer(params: DockerCLIParameters | DockerResolverParameters, projectName: string, serviceName: string): Promise<string | undefined> {
	const list = await listContainers(params, true, [
		`${projectLabel}=${projectName}`,
		`${serviceLabel}=${serviceName}`
	]);
	return list && list[0];
}

export async function getProjectName(params: DockerCLIParameters | DockerResolverParameters, workspace: Workspace, composeFiles: string[], composeConfig: any) {
	const { cliHost } = 'cliHost' in params ? params : params.common;
	const newProjectName = await useNewProjectName(params);
	const envName = toProjectName(cliHost.env.COMPOSE_PROJECT_NAME || '', newProjectName);
	if (envName) {
		return envName;
	}
	try {
		const envPath = cliHost.path.join(cliHost.cwd, '.env');
		const buffer = await cliHost.readFile(envPath);
		const match = /^COMPOSE_PROJECT_NAME=(.+)$/m.exec(buffer.toString());
		const value = match && match[1].trim();
		const envFileName = toProjectName(value || '', newProjectName);
		if (envFileName) {
			return envFileName;
		}
	} catch (err) {
		if (!(err && (err.code === 'ENOENT' || err.code === 'EISDIR'))) {
			throw err;
		}
	}
	if (composeConfig?.name) {
		if (composeConfig.name !== 'devcontainer') {
			return toProjectName(composeConfig.name, newProjectName);
		}
		// Check if 'devcontainer' is from a compose file or just the default.
		for (let i = composeFiles.length - 1; i >= 0; i--) {
			try {
				const fragment = yaml.load((await cliHost.readFile(composeFiles[i])).toString()) || {} as any;
				if (fragment.name) {
					// Use composeConfig.name ('devcontainer') because fragment.name could include environment variables.
					return toProjectName(composeConfig.name, newProjectName);
				}
			} catch (error) {
				// Ignore when parsing fails due to custom yaml tags (e.g., !reset)
			}
		}
	}
	const configDir = workspace.configFolderPath;
	const workingDir = composeFiles[0] ? cliHost.path.dirname(composeFiles[0]) : cliHost.cwd; // From https://github.com/docker/compose/blob/79557e3d3ab67c3697641d9af91866d7e400cfeb/compose/config/config.py#L290
	if (equalPaths(cliHost.platform, workingDir, cliHost.path.join(configDir, '.devcontainer'))) {
		return toProjectName(`${cliHost.path.basename(configDir)}_devcontainer`, newProjectName);
	}
	return toProjectName(cliHost.path.basename(workingDir), newProjectName);
}

function toProjectName(basename: string, newProjectName: boolean) {
	// From https://github.com/docker/compose/blob/79557e3d3ab67c3697641d9af91866d7e400cfeb/compose/cli/command.py#L152
	if (!newProjectName) {
		return basename.toLowerCase().replace(/[^a-z0-9]/g, '');
	}
	return basename.toLowerCase().replace(/[^-_a-z0-9]/g, '');
}

async function useNewProjectName(params: DockerCLIParameters | DockerResolverParameters) {
	try {
		const version = parseVersion((await params.dockerComposeCLI()).version);
		if (!version) {
			return true; // Optimistically continue.
		}
		return !isEarlierVersion(version, [1, 21, 0]); // 1.21.0 changed allowed characters in project names (added hyphen and underscore).
	} catch (err) {
		return true; // Optimistically continue.
	}
}

export function dockerComposeCLIConfig(params: Omit<PartialExecParameters, 'cmd'>, dockerCLICmd: string, dockerComposeCLICmd: string) {
	let result: Promise<DockerComposeCLI>;
	return () => {
		return result || (result = (async () => {
			let v2 = true;
			let stdout: Buffer;
			try {
				stdout = (await dockerComposeCLI({
					...params,
					cmd: dockerCLICmd,
				}, 'compose', 'version', '--short')).stdout;
			} catch (err) {
				stdout = (await dockerComposeCLI({
					...params,
					cmd: dockerComposeCLICmd,
				}, 'version', '--short')).stdout;
				v2 = false;
			}
			const version = stdout.toString().trim();
			params.output.write(`Docker Compose version: ${version}`);
			return {
				version,
				cmd: v2 ? dockerCLICmd : dockerComposeCLICmd,
				args: v2 ? ['compose'] : [],
			};
		})());
	};
}

/**
 * Convert mount command arguments to Docker Compose volume
 * @param mount
 * @returns mount command representation for Docker compose
 */
function convertMountToVolume(mount: Mount): string {
	let volume: string = '';

	if (mount.source) {
		volume = `${mount.source}:`;
	}

	volume += mount.target;

	return volume;
}

/**
 * Convert mount command arguments to volume top-level element
 * @param mount
 * @returns mount object representation as volumes top-level element
 */
function convertMountToVolumeTopLevelElement(mount: Mount): string {
	let volume: string = `
  ${mount.source}:`;

	if (mount.external) {
		volume += '\n    external: true';
	}

	return volume;
}
