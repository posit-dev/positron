/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import { DevContainerConfig } from '../spec-configuration/configuration';
import { dockerCLI, dockerPtyCLI, ImageDetails, toExecParameters, toPtyExecParameters } from '../spec-shutdown/dockerUtils';
import { LogLevel, makeLog } from '../spec-utils/log';
import { FeaturesConfig, getContainerFeaturesBaseDockerFile, getFeatureInstallWrapperScript, getFeatureLayers, getFeatureMainValue, getFeatureValueObject, generateFeaturesConfig, Feature, generateContainerEnvs } from '../spec-configuration/containerFeaturesConfiguration';
import { readLocalFile } from '../spec-utils/pfs';
import { includeAllConfiguredFeatures } from '../spec-utils/product';
import { createFeaturesTempFolder, DockerResolverParameters, getCacheFolder, getFolderImageName, getEmptyContextFolder, SubstitutedConfig } from './utils';
import { isEarlierVersion, parseVersion, runCommandNoPty } from '../spec-common/commonUtils';
import { getDevcontainerMetadata, getDevcontainerMetadataLabel, getImageBuildInfoFromImage, ImageBuildInfo, ImageMetadataEntry, imageMetadataLabel, MergedDevContainerConfig } from './imageMetadata';
import { supportsBuildContexts } from './dockerfileUtils';
import { ContainerError } from '../spec-common/errors';

// Escapes environment variable keys.
//
// Environment variables must contain:
//      - alpha-numeric values, or
//      - the '_' character, and
//      - a number cannot be the first character
export const getSafeId = (str: string) => str
	.replace(/[^\w_]/g, '_')
	.replace(/^[\d_]+/g, '_')
	.toUpperCase();

export async function extendImage(params: DockerResolverParameters, config: SubstitutedConfig<DevContainerConfig>, imageName: string, additionalImageNames: string[], additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>, canAddLabelsToContainer: boolean) {
	const { common } = params;
	const { cliHost, output } = common;

	const imageBuildInfo = await getImageBuildInfoFromImage(params, imageName, config.substitute);
	const extendImageDetails = await getExtendImageBuildInfo(params, config, imageName, imageBuildInfo, undefined, additionalFeatures, canAddLabelsToContainer);
	if (!extendImageDetails?.featureBuildInfo) {
		// no feature extensions - return
		if (additionalImageNames.length) {
			if (params.isTTY) {
				await Promise.all(additionalImageNames.map(name => dockerPtyCLI(params, 'tag', imageName, name)));
			} else {
				await Promise.all(additionalImageNames.map(name => dockerCLI(params, 'tag', imageName, name)));
			}
		}
		return {
			updatedImageName: [imageName],
			imageMetadata: getDevcontainerMetadata(imageBuildInfo.metadata, config, extendImageDetails?.featuresConfig),
			imageDetails: async () => imageBuildInfo.imageDetails,
			labels: extendImageDetails?.labels,
		};
	}
	const { featureBuildInfo, featuresConfig } = extendImageDetails;

	// Got feature extensions -> build the image
	const dockerfilePath = cliHost.path.join(featureBuildInfo.dstFolder, 'Dockerfile.extended');
	await cliHost.writeFile(dockerfilePath, Buffer.from(featureBuildInfo.dockerfilePrefixContent + featureBuildInfo.dockerfileContent));
	const folderImageName = getFolderImageName(common);
	const updatedImageName = `${imageName.startsWith(folderImageName) ? imageName : folderImageName}-features`;

	const args: string[] = [];
	if (!params.buildKitVersion &&
		(params.buildxPlatform || params.buildxPush)) {
		throw new ContainerError({ description: '--platform or --push require BuildKit enabled.', data: { fileWithError: dockerfilePath } });
	}
	if (params.buildKitVersion) {
		args.push('buildx', 'build');

		// --platform
		if (params.buildxPlatform) {
			output.write('Setting BuildKit platform(s): ' + params.buildxPlatform, LogLevel.Trace);
			args.push('--platform', params.buildxPlatform);
		}

		// --push/--output
		if (params.buildxPush) {
			args.push('--push');
		} else {
			if (params.buildxOutput) {
				args.push('--output', params.buildxOutput);
			} else {
				args.push('--load'); // (short for --output=docker, i.e. load into normal 'docker images' collection)
			}
		}
		if (params.buildxCacheTo) {
			args.push('--cache-to', params.buildxCacheTo);
		}
		if (!params.buildNoCache) {
			params.additionalCacheFroms.forEach(cacheFrom => args.push('--cache-from', cacheFrom));
		}

		for (const buildContext in featureBuildInfo.buildKitContexts) {
			args.push('--build-context', `${buildContext}=${featureBuildInfo.buildKitContexts[buildContext]}`);
		}

		for (const securityOpt of featureBuildInfo.securityOpts) {
			args.push('--security-opt', securityOpt);
		}
	} else {
		// Not using buildx
		args.push(
			'build',
		);
	}
	if (params.buildNoCache) {
		args.push('--no-cache');
	}
	for (const buildArg in featureBuildInfo.buildArgs) {
		args.push('--build-arg', `${buildArg}=${featureBuildInfo.buildArgs[buildArg]}`);
	}
	// Once this is step merged with the user Dockerfile (or working against the base image),
	// the path will be the dev container context
	// Set empty dir under temp path as the context for now to ensure we don't have dependencies on the features content
	const emptyTempDir = getEmptyContextFolder(common);
	cliHost.mkdirp(emptyTempDir);
	args.push(
		'--target', featureBuildInfo.overrideTarget,
		'-f', dockerfilePath,
		...additionalImageNames.length > 0 ? additionalImageNames.map(name => ['-t', name]).flat() : ['-t', updatedImageName],
		...params.additionalLabels.length > 0 ? params.additionalLabels.map(label => ['--label', label]).flat() : [],
		emptyTempDir
	);

	if (params.isTTY) {
		const infoParams = { ...toPtyExecParameters(params), output: makeLog(output, LogLevel.Info) };
		await dockerPtyCLI(infoParams, ...args);
	} else {
		const infoParams = { ...toExecParameters(params), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
		await dockerCLI(infoParams, ...args);
	}
	return {
		updatedImageName: additionalImageNames.length > 0 ? additionalImageNames : [updatedImageName],
		imageMetadata: getDevcontainerMetadata(imageBuildInfo.metadata, config, featuresConfig),
		imageDetails: async () => imageBuildInfo.imageDetails,
	};
}

export async function getExtendImageBuildInfo(params: DockerResolverParameters, config: SubstitutedConfig<DevContainerConfig>, baseName: string, imageBuildInfo: ImageBuildInfo, composeServiceUser: string | undefined, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>, canAddLabelsToContainer: boolean): Promise<{ featureBuildInfo?: ImageBuildOptions; featuresConfig?: FeaturesConfig; labels?: Record<string, string> } | undefined> {

	// Creates the folder where the working files will be setup.
	const dstFolder = await createFeaturesTempFolder(params.common);

	// Processes the user's configuration.
	const platform = params.common.cliHost.platform;

	const cacheFolder = await getCacheFolder(params.common.cliHost);
	const { experimentalLockfile, experimentalFrozenLockfile } = params;
	const featuresConfig = await generateFeaturesConfig({ ...params.common, platform, cacheFolder, experimentalLockfile, experimentalFrozenLockfile }, dstFolder, config.config, additionalFeatures);
	if (!featuresConfig) {
		if (canAddLabelsToContainer && !imageBuildInfo.dockerfile) {
			return {
				labels: {
					[imageMetadataLabel]: JSON.stringify(getDevcontainerMetadata(imageBuildInfo.metadata, config, undefined, [], getOmitDevcontainerPropertyOverride(params.common)).raw),
				}
			};
		}
		return { featureBuildInfo: getImageBuildOptions(params, config, dstFolder, baseName, imageBuildInfo) };
	}

	// Generates the end configuration.
	const featureBuildInfo = await getFeaturesBuildOptions(params, config, featuresConfig, baseName, imageBuildInfo, composeServiceUser);
	if (!featureBuildInfo) {
		return undefined;
	}
	return { featureBuildInfo, featuresConfig };

}

// NOTE: only exported to enable testing. Not meant to be called outside file.
export function generateContainerEnvsV1(featuresConfig: FeaturesConfig) {
	let result = '';
	for (const fSet of featuresConfig.featureSets) {
		// We only need to generate this ENV references for the initial features specification.
		if (fSet.internalVersion !== '2')
		{
			result += '\n';
			result += fSet.features
				.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
				.reduce((envs, f) => envs.concat(generateContainerEnvs(f.containerEnv)), [] as string[])
				.join('\n');
		}
	}
	return result;
}

export interface ImageBuildOptions {
	dstFolder: string;
	dockerfileContent: string;
	overrideTarget: string;
	dockerfilePrefixContent: string;
	buildArgs: Record<string, string>;
	buildKitContexts: Record<string, string>;
	securityOpts: string[];
}

function getImageBuildOptions(params: DockerResolverParameters, config: SubstitutedConfig<DevContainerConfig>, dstFolder: string, baseName: string, imageBuildInfo: ImageBuildInfo): ImageBuildOptions {
	const syntax = imageBuildInfo.dockerfile?.preamble.directives.syntax;
	return {
		dstFolder,
		dockerfileContent: `
FROM $_DEV_CONTAINERS_BASE_IMAGE AS dev_containers_target_stage
${getDevcontainerMetadataLabel(getDevcontainerMetadata(imageBuildInfo.metadata, config, { featureSets: [] }, [], getOmitDevcontainerPropertyOverride(params.common)))}
`,
		overrideTarget: 'dev_containers_target_stage',
		dockerfilePrefixContent: `${syntax ? `# syntax=${syntax}` : ''}
	ARG _DEV_CONTAINERS_BASE_IMAGE=placeholder
`,
		buildArgs: {
			_DEV_CONTAINERS_BASE_IMAGE: baseName,
		} as Record<string, string>,
		buildKitContexts: {} as Record<string, string>,
		securityOpts: [],
	};
}

function getOmitDevcontainerPropertyOverride(resolverParams: { omitConfigRemotEnvFromMetadata?: boolean }): (keyof DevContainerConfig & keyof ImageMetadataEntry)[] {
	if (resolverParams.omitConfigRemotEnvFromMetadata) {
		return ['remoteEnv'];
	}

	return [];
}

async function getFeaturesBuildOptions(params: DockerResolverParameters, devContainerConfig: SubstitutedConfig<DevContainerConfig>, featuresConfig: FeaturesConfig, baseName: string, imageBuildInfo: ImageBuildInfo, composeServiceUser: string | undefined): Promise<ImageBuildOptions | undefined> {
	const { common } = params;
	const { cliHost, output } = common;
	const { dstFolder } = featuresConfig;

	if (!dstFolder || dstFolder === '') {
		output.write('dstFolder is undefined or empty in addContainerFeatures', LogLevel.Error);
		return undefined;
	}

	// With Buildkit (0.8.0 or later), we can supply an additional build context to provide access to
	// the container-features content.
	// For non-Buildkit, we build a temporary image to hold the container-features content in a way
	// that is accessible from the docker build for non-BuiltKit builds
	// TODO generate an image name that is specific to this dev container?
	const buildKitVersionParsed = params.buildKitVersion?.versionMatch ? parseVersion(params.buildKitVersion.versionMatch) : undefined;
	const minRequiredVersion = [0, 8, 0];
	const useBuildKitBuildContexts = buildKitVersionParsed ? !isEarlierVersion(buildKitVersionParsed, minRequiredVersion) : false;
	const buildContentImageName = 'dev_container_feature_content_temp';
	const disableSELinuxLabels = useBuildKitBuildContexts && await isUsingSELinuxLabels(params);

	const omitPropertyOverride = params.common.skipPersistingCustomizationsFromFeatures ? ['customizations'] : [];
	const imageMetadata = getDevcontainerMetadata(imageBuildInfo.metadata, devContainerConfig, featuresConfig, omitPropertyOverride, getOmitDevcontainerPropertyOverride(params.common));
	const { containerUser, remoteUser } = findContainerUsers(imageMetadata, composeServiceUser, imageBuildInfo.user);
	const builtinVariables = [
		`_CONTAINER_USER=${containerUser}`,
		`_REMOTE_USER=${remoteUser}`,
	];
	const envPath = cliHost.path.join(dstFolder, 'devcontainer-features.builtin.env');
	await cliHost.writeFile(envPath, Buffer.from(builtinVariables.join('\n') + '\n'));

	// When copying via buildkit, the content is accessed via '.' (i.e. in the context root)
	// When copying via temp image, the content is in '/tmp/build-features'
	const contentSourceRootPath = useBuildKitBuildContexts ? '.' : '/tmp/build-features/';
	const dockerfile = getContainerFeaturesBaseDockerFile(contentSourceRootPath)
		.replace('#{nonBuildKitFeatureContentFallback}', useBuildKitBuildContexts ? '' : `FROM ${buildContentImageName} as dev_containers_feature_content_source`)
		.replace('#{featureLayer}', getFeatureLayers(featuresConfig, containerUser, remoteUser, useBuildKitBuildContexts, contentSourceRootPath))
		.replace('#{containerEnv}', generateContainerEnvsV1(featuresConfig))
		.replace('#{devcontainerMetadata}', getDevcontainerMetadataLabel(imageMetadata))
		.replace('#{containerEnvMetadata}', generateContainerEnvs(devContainerConfig.config.containerEnv, true))
		;
	const syntax = imageBuildInfo.dockerfile?.preamble.directives.syntax;
	const omitSyntaxDirective = common.omitSyntaxDirective; // Can be removed when https://github.com/moby/buildkit/issues/4556 is fixed
	const dockerfilePrefixContent = `${omitSyntaxDirective ? '' :
		useBuildKitBuildContexts && !(imageBuildInfo.dockerfile && supportsBuildContexts(imageBuildInfo.dockerfile)) ? '# syntax=docker/dockerfile:1.4' :
		syntax ? `# syntax=${syntax}` : ''}
ARG _DEV_CONTAINERS_BASE_IMAGE=placeholder
`;

	// Build devcontainer-features.env and devcontainer-features-install.sh file(s) for each features source folder
	for await (const fSet of featuresConfig.featureSets) {
		if (fSet.internalVersion === '2')
		{
			for await (const fe of fSet.features) {
				if (fe.cachePath)
				{
					fe.internalVersion = '2';
					const envPath = cliHost.path.join(fe.cachePath, 'devcontainer-features.env');
					const variables = getFeatureEnvVariables(fe);
					await cliHost.writeFile(envPath, Buffer.from(variables.join('\n')));

					const installWrapperPath = cliHost.path.join(fe.cachePath, 'devcontainer-features-install.sh');
					const installWrapperContent = getFeatureInstallWrapperScript(fe, fSet, variables);
					await cliHost.writeFile(installWrapperPath, Buffer.from(installWrapperContent));
				}
			}
		} else {
			const featuresEnv = ([] as string[]).concat(
				...fSet.features
					.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
					.map(getFeatureEnvVariables)
			).join('\n');
			const envPath = cliHost.path.join(fSet.features[0].cachePath!, 'devcontainer-features.env');
			await Promise.all([
				cliHost.writeFile(envPath, Buffer.from(featuresEnv)),
				...fSet.features
					.filter(f => (includeAllConfiguredFeatures || f.included) && f.value)
				.map(f => {
					const consecutiveId = f.consecutiveId;
					if (!consecutiveId) {
						throw new Error('consecutiveId is undefined for Feature ' + f.id);
					}
					const featuresEnv = [
						...getFeatureEnvVariables(f),
						`_BUILD_ARG_${getSafeId(f.id)}_TARGETPATH=${path.posix.join('/usr/local/devcontainer-features', consecutiveId)}`
					]
						.join('\n');
					const envPath = cliHost.path.join(dstFolder, consecutiveId, 'devcontainer-features.env'); // next to bin/acquire
						return cliHost.writeFile(envPath, Buffer.from(featuresEnv));
					})
			]);
		}
	}

	// For non-BuildKit, build the temporary image for the container-features content
	if (!useBuildKitBuildContexts) {
		const buildContentDockerfile = `
	FROM scratch
	COPY . /tmp/build-features/
	`;
		const buildContentDockerfilePath = cliHost.path.join(dstFolder, 'Dockerfile.buildContent');
		await cliHost.writeFile(buildContentDockerfilePath, Buffer.from(buildContentDockerfile));
		const buildContentArgs = [
			'build',
			'-t', buildContentImageName,
			'-f', buildContentDockerfilePath,
		];
		buildContentArgs.push(dstFolder);

		if (params.isTTY) {
			const buildContentInfoParams = { ...toPtyExecParameters(params), output: makeLog(output, LogLevel.Info) };
			await dockerPtyCLI(buildContentInfoParams, ...buildContentArgs);
		} else {
			const buildContentInfoParams = { ...toExecParameters(params), output: makeLog(output, LogLevel.Info), print: 'continuous' as 'continuous' };
			await dockerCLI(buildContentInfoParams, ...buildContentArgs);
		}
	}
	return {
		dstFolder,
		dockerfileContent: dockerfile,
		overrideTarget: 'dev_containers_target_stage',
		dockerfilePrefixContent,
		buildArgs: {
			_DEV_CONTAINERS_BASE_IMAGE: baseName,
			_DEV_CONTAINERS_IMAGE_USER: imageBuildInfo.user,
			_DEV_CONTAINERS_FEATURE_CONTENT_SOURCE: buildContentImageName,
		},
		buildKitContexts: useBuildKitBuildContexts ? { dev_containers_feature_content_source: dstFolder } : {},
		securityOpts: disableSELinuxLabels ? ['label=disable'] : [],
	};
}

async function isUsingSELinuxLabels(params: DockerResolverParameters): Promise<boolean> {
	try {
		const { common } = params;
		const { cliHost, output } = common;
		return params.isPodman && cliHost.platform === 'linux'
			&& (await runCommandNoPty({
				exec: cliHost.exec,
				cmd: 'getenforce',
				output,
				print: true,
			})).stdout.toString().trim() !== 'Disabled'
			&& (await dockerCLI({
				...toExecParameters(params),
				print: true,
			}, 'info', '-f', '{{.Host.Security.SELinuxEnabled}}')).stdout.toString().trim() === 'true';
	} catch {
		// If we can't run the commands, assume SELinux is not enabled.
		return false;
		
	}
}

export function findContainerUsers(imageMetadata: SubstitutedConfig<ImageMetadataEntry[]>, composeServiceUser: string | undefined, imageUser: string) {
	const reversed = imageMetadata.config.slice().reverse();
	const containerUser = reversed.find(entry => entry.containerUser)?.containerUser || composeServiceUser || imageUser;
	const remoteUser = reversed.find(entry => entry.remoteUser)?.remoteUser || containerUser;
	return { containerUser, remoteUser };
}


function getFeatureEnvVariables(f: Feature) {
	const values = getFeatureValueObject(f);
	const idSafe = getSafeId(f.id);
	const variables = [];

	if(f.internalVersion !== '2')
	{
		if (values) {
			variables.push(...Object.keys(values)
				.map(name => `_BUILD_ARG_${idSafe}_${getSafeId(name)}="${values[name]}"`));
			variables.push(`_BUILD_ARG_${idSafe}=true`);
		}
		if (f.buildArg) {
			variables.push(`${f.buildArg}=${getFeatureMainValue(f)}`);
		}
		return variables;
	} else {
		if (values) {
			variables.push(...Object.keys(values)
				.map(name => `${getSafeId(name)}="${values[name]}"`));
		}
		if (f.buildArg) {
			variables.push(`${f.buildArg}=${getFeatureMainValue(f)}`);
		}
		return variables;
	}
}

export async function getRemoteUserUIDUpdateDetails(params: DockerResolverParameters, mergedConfig: MergedDevContainerConfig, imageName: string, imageDetails: () => Promise<ImageDetails>, runArgsUser: string | undefined) {
	const { common } = params;
	const { cliHost } = common;
	const { updateRemoteUserUID } = mergedConfig;
	if (params.updateRemoteUserUIDDefault === 'never' || !(typeof updateRemoteUserUID === 'boolean' ? updateRemoteUserUID : params.updateRemoteUserUIDDefault === 'on') || !(cliHost.platform === 'linux' || params.updateRemoteUserUIDOnMacOS && cliHost.platform === 'darwin')) {
		return null;
	}
	const details = await imageDetails();
	const imageUser = details.Config.User || 'root';
	const remoteUser = mergedConfig.remoteUser || runArgsUser || imageUser;
	if (remoteUser === 'root' || /^\d+$/.test(remoteUser)) {
		return null;
	}
	const folderImageName = getFolderImageName(common);
	const fixedImageName = `${imageName.startsWith(folderImageName) ? imageName : folderImageName}-uid`;

	return {
		imageName: fixedImageName,
		remoteUser,
		imageUser,
		platform: [details.Os, details.Architecture, details.Variant].filter(Boolean).join('/')
	};
}

export async function updateRemoteUserUID(params: DockerResolverParameters, mergedConfig: MergedDevContainerConfig, imageName: string, imageDetails: () => Promise<ImageDetails>, runArgsUser: string | undefined) {
	const { common } = params;
	const { cliHost } = common;

	const updateDetails = await getRemoteUserUIDUpdateDetails(params, mergedConfig, imageName, imageDetails, runArgsUser);
	if (!updateDetails) {
		return imageName;
	}
	const { imageName: fixedImageName, remoteUser, imageUser, platform } = updateDetails;

	const dockerfileName = 'updateUID.Dockerfile';
	const srcDockerfile = path.join(common.extensionPath, 'scripts', dockerfileName);
	const version = common.package.version;
	const destDockerfile = cliHost.path.join(await getCacheFolder(cliHost), `${dockerfileName}-${version}`);
	const tmpDockerfile = `${destDockerfile}-${Date.now()}`;
	await cliHost.mkdirp(cliHost.path.dirname(tmpDockerfile));
	await cliHost.writeFile(tmpDockerfile, await readLocalFile(srcDockerfile));
	await cliHost.rename(tmpDockerfile, destDockerfile);
	const emptyFolder = getEmptyContextFolder(common);
	await cliHost.mkdirp(emptyFolder);
	const args = [
		'build',
		'-f', destDockerfile,
		'-t', fixedImageName,
		...(platform ? ['--platform', platform] : []),
		'--build-arg', `BASE_IMAGE=${params.isPodman && !hasRegistryHostname(imageName) ? 'localhost/' : ''}${imageName}`, // Podman: https://github.com/microsoft/vscode-remote-release/issues/9748
		'--build-arg', `REMOTE_USER=${remoteUser}`,
		'--build-arg', `NEW_UID=${await cliHost.getuid!()}`,
		'--build-arg', `NEW_GID=${await cliHost.getgid!()}`,
		'--build-arg', `IMAGE_USER=${imageUser}`,
		emptyFolder,
	];
	if (params.isTTY) {
		await dockerPtyCLI(params, ...args);
	} else {
		await dockerCLI(params, ...args);
	}
	return fixedImageName;
}

function hasRegistryHostname(imageName: string) {
	if (imageName.startsWith('localhost/')) {
		return true;
	}
	const dot = imageName.indexOf('.');
	const slash = imageName.indexOf('/');
	return dot !== -1 && slash !== -1 && dot < slash;
}
