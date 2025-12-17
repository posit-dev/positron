/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { URI } from 'vscode-uri';
import { FileHost, parentURI, uriToFsPath } from './configurationCommonUtils';
import { Mount } from './containerFeaturesConfiguration';
import { RemoteDocuments } from './editableFiles';

export type DevContainerConfig = DevContainerFromImageConfig | DevContainerFromDockerfileConfig | DevContainerFromDockerComposeConfig;

export interface PortAttributes {
	label: string | undefined;
	onAutoForward: string | undefined;
	elevateIfNeeded: boolean | undefined;
}

export type UserEnvProbe = 'none' | 'loginInteractiveShell' | 'interactiveShell' | 'loginShell';

export type DevContainerConfigCommand = 'initializeCommand' | 'onCreateCommand' | 'updateContentCommand' | 'postCreateCommand' | 'postStartCommand' | 'postAttachCommand';

export interface HostGPURequirements {
	cores?: number;
	memory?: string;
}

export interface HostRequirements {
	cpus?: number;
	memory?: string;
	storage?: string;
	gpu?: boolean | 'optional' | HostGPURequirements;
}

export interface DevContainerFeature {
	userFeatureId: string;
	options: boolean | string | Record<string, boolean | string | undefined>;
}

export interface DevContainerFromImageConfig {
	configFilePath?: URI;
	image?: string; // Only optional when setting up an existing container as a dev container.
	name?: string;
	forwardPorts?: (number | string)[];
	appPort?: number | string | (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	runArgs?: string[];
	shutdownAction?: 'none' | 'stopContainer';
	overrideCommand?: boolean;
	initializeCommand?: string | string[];
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	/** remote path to folder or workspace */
	workspaceFolder?: string;
	workspaceMount?: string;
	mounts?: (Mount | string)[];
	containerEnv?: Record<string, string>;
	containerUser?: string;
	init?: boolean;
	privileged?: boolean;
	capAdd?: string[];
	securityOpt?: string[];
	remoteEnv?: Record<string, string | null>;
	remoteUser?: string;
	updateRemoteUserUID?: boolean;
	userEnvProbe?: UserEnvProbe;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	overrideFeatureInstallOrder?: string[];
	hostRequirements?: HostRequirements;
	customizations?: Record<string, any>;
}

export type DevContainerFromDockerfileConfig = {
	configFilePath: URI;
	name?: string;
	forwardPorts?: (number | string)[];
	appPort?: number | string | (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	runArgs?: string[];
	shutdownAction?: 'none' | 'stopContainer';
	overrideCommand?: boolean;
	initializeCommand?: string | string[];
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	/** remote path to folder or workspace */
	workspaceFolder?: string;
	workspaceMount?: string;
	mounts?: (Mount | string)[];
	containerEnv?: Record<string, string>;
	containerUser?: string;
	init?: boolean;
	privileged?: boolean;
	capAdd?: string[];
	securityOpt?: string[];
	remoteEnv?: Record<string, string | null>;
	remoteUser?: string;
	updateRemoteUserUID?: boolean;
	userEnvProbe?: UserEnvProbe;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	overrideFeatureInstallOrder?: string[];
	hostRequirements?: HostRequirements;
	customizations?: Record<string, any>;
} & (
		{
			dockerFile: string;
			context?: string;
			build?: {
				target?: string;
				args?: Record<string, string>;
				cacheFrom?: string | string[];
				options?: string[];
			};
		}
		|
		{
			build: {
				dockerfile: string;
				context?: string;
				target?: string;
				args?: Record<string, string>;
				cacheFrom?: string | string[];
				options?: string[];
			};
		}
	);

export interface DevContainerFromDockerComposeConfig {
	configFilePath: URI;
	dockerComposeFile: string | string[];
	service: string;
	workspaceFolder: string;
	name?: string;
	forwardPorts?: (number | string)[];
	portsAttributes?: Record<string, PortAttributes>;
	otherPortsAttributes?: PortAttributes;
	shutdownAction?: 'none' | 'stopCompose';
	overrideCommand?: boolean;
	initializeCommand?: string | string[];
	onCreateCommand?: string | string[];
	updateContentCommand?: string | string[];
	postCreateCommand?: string | string[];
	postStartCommand?: string | string[];
	postAttachCommand?: string | string[];
	waitFor?: DevContainerConfigCommand;
	runServices?: string[];
	mounts?: (Mount | string)[];
	containerEnv?: Record<string, string>;
	containerUser?: string;
	init?: boolean;
	privileged?: boolean;
	capAdd?: string[];
	securityOpt?: string[];
	remoteEnv?: Record<string, string | null>;
	remoteUser?: string;
	updateRemoteUserUID?: boolean;
	userEnvProbe?: UserEnvProbe;
	features?: Record<string, string | boolean | Record<string, string | boolean>>;
	overrideFeatureInstallOrder?: string[];
	hostRequirements?: HostRequirements;
	customizations?: Record<string, any>;
}

interface DevContainerVSCodeConfig {
	extensions?: string[];
	settings?: object;
	devPort?: number;
}

export interface VSCodeCustomizations {
	vscode?: DevContainerVSCodeConfig;
}

export function updateFromOldProperties<T extends DevContainerConfig & DevContainerVSCodeConfig & { customizations?: VSCodeCustomizations }>(original: T): T {
	// https://github.com/microsoft/dev-container-spec/issues/1
	if (!(original.extensions || original.settings || original.devPort !== undefined)) {
		return original;
	}
	const copy = { ...original };
	const customizations = copy.customizations || (copy.customizations = {});
	const vscode = customizations.vscode || (customizations.vscode = {});
	if (copy.extensions) {
		vscode.extensions = (vscode.extensions || []).concat(copy.extensions);
		delete copy.extensions;
	}
	if (copy.settings) {
		vscode.settings = {
			...copy.settings,
			...(vscode.settings || {}),
		};
		delete copy.settings;
	}
	if (copy.devPort !== undefined && vscode.devPort === undefined) {
		vscode.devPort = copy.devPort;
		delete copy.devPort;
	}
	return copy;
}

export function getConfigFilePath(cliHost: { platform: NodeJS.Platform }, config: { configFilePath: URI }, relativeConfigFilePath: string) {
	return resolveConfigFilePath(cliHost, config.configFilePath, relativeConfigFilePath);
}

export function resolveConfigFilePath(cliHost: { platform: NodeJS.Platform }, configFilePath: URI, relativeConfigFilePath: string) {
	const folder = parentURI(configFilePath);
	return configFilePath.with({
		path: path.posix.resolve(folder.path, (cliHost.platform === 'win32' && configFilePath.scheme !== RemoteDocuments.scheme) ? (path.win32.isAbsolute(relativeConfigFilePath) ? '/' : '') + relativeConfigFilePath.replace(/\\/g, '/') : relativeConfigFilePath)
	});
}

export function isDockerFileConfig(config: DevContainerConfig): config is DevContainerFromDockerfileConfig {
	return 'dockerFile' in config || ('build' in config && 'dockerfile' in config.build);
}

export function getDockerfilePath(cliHost: { platform: NodeJS.Platform }, config: DevContainerFromDockerfileConfig) {
	return getConfigFilePath(cliHost, config, getDockerfile(config));
}

export function getDockerfile(config: DevContainerFromDockerfileConfig) {
	return 'dockerFile' in config ? config.dockerFile : config.build.dockerfile;
}

export async function getDockerComposeFilePaths(cliHost: FileHost, config: DevContainerFromDockerComposeConfig, envForComposeFile: NodeJS.ProcessEnv, cwdForDefaultFiles: string) {
	if (Array.isArray(config.dockerComposeFile)) {
		if (config.dockerComposeFile.length) {
			return config.dockerComposeFile.map(composeFile => uriToFsPath(getConfigFilePath(cliHost, config, composeFile), cliHost.platform));
		}
	} else if (typeof config.dockerComposeFile === 'string') {
		return [uriToFsPath(getConfigFilePath(cliHost, config, config.dockerComposeFile), cliHost.platform)];
	}
	
	const envComposeFile = envForComposeFile?.COMPOSE_FILE;
	if (envComposeFile) {
		return envComposeFile.split(cliHost.path.delimiter)
			.map(composeFile => cliHost.path.resolve(cwdForDefaultFiles, composeFile));
	}

	try {
		const envPath = cliHost.path.join(cwdForDefaultFiles, '.env');
		const buffer = await cliHost.readFile(envPath);
		const match = /^COMPOSE_FILE=(.+)$/m.exec(buffer.toString());
		const envFileComposeFile = match && match[1].trim();
		if (envFileComposeFile) {
			return envFileComposeFile.split(cliHost.path.delimiter)
				.map(composeFile => cliHost.path.resolve(cwdForDefaultFiles, composeFile));
		}
	} catch (err) {
		if (!(err && (err.code === 'ENOENT' || err.code === 'EISDIR'))) {
			throw err;
		}
	}

	const defaultFiles = [cliHost.path.resolve(cwdForDefaultFiles, 'docker-compose.yml')];
	const override = cliHost.path.resolve(cwdForDefaultFiles, 'docker-compose.override.yml');
	if (await cliHost.isFile(override)) {
		defaultFiles.push(override);
	}
	return defaultFiles;
}
