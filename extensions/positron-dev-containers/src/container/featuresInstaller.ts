/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { getLogger } from '../common/logger';
import { Configuration } from '../common/configuration';
import { getCLIHost, loadNativeModule } from '../spec/spec-common/commonUtils';
import { createDockerParams } from '../spec/spec-node/devContainers';
import { generateFeaturesConfig, FeaturesConfig } from '../spec/spec-configuration/containerFeaturesConfiguration';
import { rmLocal } from '../spec/spec-utils/pfs';
import { LogLevel } from '../spec/spec-utils/log';

/**
 * Result from preparing features installation
 */
export interface FeaturesInstallInfo {
	/**
	 * Whether any features need to be installed
	 */
	hasFeatures: boolean;

	/**
	 * Features configuration
	 */
	featuresConfig?: FeaturesConfig;

	/**
	 * Path to temporary directory containing features
	 */
	featuresDir?: string;
}

/**
 * Prepares features for installation in a container
 *
 * This function:
 * 1. Reads features from devcontainer.json
 * 2. Merges with default features from settings
 * 3. Downloads/prepares features to a temporary directory using the reference implementation
 * 4. Returns information needed to install features via terminal commands
 */
export async function prepareFeaturesInstallation(
	workspaceFolder: string,
	devContainerConfig: any
): Promise<FeaturesInstallInfo> {
	const logger = getLogger();
	const config = Configuration.getInstance();

	logger.info('==> prepareFeaturesInstallation called');
	logger.debug(`Workspace folder: ${workspaceFolder}`);

	try {
		// Merge features from devcontainer.json with default features
		const defaultFeatures = config.getDefaultFeatures();
		const configFeatures = devContainerConfig.features || {};
		const allFeatures = { ...defaultFeatures, ...configFeatures };

		logger.debug(`Default features: ${JSON.stringify(defaultFeatures)}`);
		logger.debug(`Config features: ${JSON.stringify(configFeatures)}`);
		logger.debug(`Merged features: ${JSON.stringify(allFeatures)}`);

		// Check if there are any features to install
		if (Object.keys(allFeatures).length === 0) {
			logger.debug('No features to install');
			return { hasFeatures: false };
		}

		logger.info(`Found ${Object.keys(allFeatures).length} feature(s) to install`);

		// Create temporary directory for features
		const featuresDir = path.join(os.tmpdir(), `devcontainer-features-${Date.now()}`);

		// Create CLI host for feature processing
		const cwd = workspaceFolder || process.cwd();
		const cliHost = await getCLIHost(cwd, loadNativeModule, false);
		await cliHost.mkdirp(featuresDir);
		logger.debug(`Created features directory: ${featuresDir}`);

		// Create a temporary config file path in the features directory
		// This is needed for lockfile operations to work correctly
		const tempConfigPath = path.join(featuresDir, 'devcontainer.json');
		const configFileUri = URI.file(tempConfigPath);

		// Create docker params for feature configuration
		const disposables: (() => Promise<unknown> | undefined)[] = [];
		const params = await createDockerParams(
			{
				dockerPath: config.getDockerPath(),
				dockerComposePath: config.getDockerComposePath(),
				workspaceFolder: workspaceFolder,
				mountWorkspaceGitRoot: false,
				configFile: undefined,
				overrideConfigFile: undefined,
				logLevel: LogLevel.Info,
				logFormat: 'text',
				log: (text) => logger.debug(text),
				terminalDimensions: undefined,
				defaultUserEnvProbe: 'loginInteractiveShell',
				removeExistingContainer: false,
				buildNoCache: false,
				expectExistingContainer: false,
				postCreateEnabled: false,
				skipNonBlocking: false,
				prebuild: false,
				persistedFolder: undefined,
				additionalMounts: [],
				updateRemoteUserUIDDefault: 'never',
				remoteEnv: {},
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
				containerDataFolder: undefined,
				containerSystemDataFolder: undefined,
				omitConfigRemotEnvFromMetadata: false,
				dotfiles: {},
			},
			disposables
		);

		// Generate features configuration using the reference implementation
		// This will download and prepare all features
		const cacheFolder = path.join(os.homedir(), '.devcontainer', 'cache');
		await cliHost.mkdirp(cacheFolder);

		logger.debug('Generating features configuration...');
		const featuresConfig = await generateFeaturesConfig(
			{
				...params.common,
				platform: cliHost.platform,
				cacheFolder,
				experimentalLockfile: false,
				experimentalFrozenLockfile: false,
			},
			featuresDir,
			{
				features: allFeatures,
				configFilePath: configFileUri  // Use temporary config file URI for lockfile operations
			} as any,
			{}
		);

		logger.debug(`Features config generated: ${featuresConfig ? 'yes' : 'no'}`);
		if (featuresConfig) {
			logger.debug(`Feature sets count: ${featuresConfig.featureSets.length}`);
			for (const featureSet of featuresConfig.featureSets) {
				logger.debug(`Feature set has ${featureSet.features.length} features`);
				for (const feature of featureSet.features) {
					logger.debug(`  - Feature: ${feature.id}, included: ${feature.included}, cachePath: ${feature.cachePath}`);
				}
			}
		}

		if (!featuresConfig || featuresConfig.featureSets.length === 0) {
			logger.info('No features configuration generated');
			// Clean up empty directory
			await rmLocal(featuresDir, { recursive: true, force: true });
			return { hasFeatures: false };
		}

		logger.info(`Prepared ${featuresConfig.featureSets.length} feature set(s) for installation`);
		logger.info(`Features directory: ${featuresDir}`);

		return {
			hasFeatures: true,
			featuresConfig,
			featuresDir
		};
	} catch (error) {
		logger.error('Failed to prepare features installation:', error);
		return { hasFeatures: false };
	}
}

/**
 * Generates shell script commands to install features in a running container
 *
 * @param featuresConfig Features configuration from prepareFeaturesInstallation
 * @param featuresDir Local directory containing downloaded features
 * @param dockerPath Path to docker executable
 * @param containerId Container ID (will be set from $CONTAINER_ID variable in script)
 * @param isWindows Whether running on Windows (affects script syntax)
 * @returns Shell script commands to install features
 */
export function generateFeatureInstallScript(
	featuresConfig: FeaturesConfig,
	_featuresDir: string,
	dockerPath: string,
	isWindows: boolean
): string {
	const logger = getLogger();
	logger.info('==> generateFeatureInstallScript called');
	logger.debug(`Feature sets to install: ${featuresConfig.featureSets.length}`);
	logger.debug(`Platform: ${isWindows ? 'Windows' : 'Unix'}`);

	let script = '';

	// Platform-specific commands
	const echoCmd = isWindows ? 'Write-Host' : 'echo';

	script += `${echoCmd} "==> Installing dev container features..."\n\n`;

	// Process each feature set
	for (const featureSet of featuresConfig.featureSets) {
		logger.debug(`Processing feature set with internalVersion: ${featureSet.internalVersion}`);
		logger.debug(`Feature set has ${featureSet.features.length} features`);

		for (const feature of featureSet.features) {
			if (!feature.included || !feature.cachePath) {
				logger.debug(`Skipping feature ${feature.id}: included=${feature.included}, cachePath=${feature.cachePath}`);
				continue;
			}

			const featureId = feature.id;
			const featureName = feature.name || featureId;
			const featureVersion = feature.version || 'latest';
			const consecutiveId = feature.consecutiveId || '';

			// All features have install.sh as the main installation script
			// The devcontainer-features-install.sh wrapper is only used during image build
			const installScript = 'install.sh';

			const localFeaturePath = feature.cachePath;
			const containerFeaturePath = `/tmp/dev-container-features/${consecutiveId}`;

			logger.debug(`Generating install script for feature: ${featureId}`);
			logger.debug(`  - Internal version: ${featureSet.internalVersion}`);
			logger.debug(`  - Install script name: ${installScript}`);
			logger.debug(`  - Local path: ${localFeaturePath}`);
			logger.debug(`  - Container path: ${containerFeaturePath}`);

			if (isWindows) {
				// PowerShell script
				script += `Write-Host "==> Installing feature: ${featureName} (${featureVersion})"\n`;

				// Create directory in container
				script += `& ${dockerPath} exec $CONTAINER_ID mkdir -p "${containerFeaturePath}"\n`;

				// Copy feature files into container
				script += `& ${dockerPath} cp -a "${localFeaturePath.replace(/\\/g, '/')}/.\" "$CONTAINER_ID:${containerFeaturePath}/"\n`;

				// Set permissions and run install script
				script += `& ${dockerPath} exec $CONTAINER_ID sh -c "cd ${containerFeaturePath} && chmod +x ./${installScript} && ./${installScript}"\n`;
				script += 'if ($LASTEXITCODE -ne 0) {\n';
				script += `    Write-Host "Warning: Feature '${featureName}' installation had errors (exit code $LASTEXITCODE)" -ForegroundColor Yellow\n`;
				script += '}\n\n';
			} else {
				// Bash script
				script += `echo "==> Installing feature: ${featureName} (${featureVersion})"\n`;

				// Create directory in container
				script += `${dockerPath} exec $CONTAINER_ID mkdir -p "${containerFeaturePath}"\n`;

				// Copy feature files into container using tar (more reliable than docker cp for directories)
				script += `tar -C "${localFeaturePath}" -cf - . | ${dockerPath} exec -i $CONTAINER_ID tar -C "${containerFeaturePath}" -xf -\n`;

				// Set permissions and run install script
				script += `${dockerPath} exec $CONTAINER_ID sh -c "cd ${containerFeaturePath} && chmod +x ./${installScript} && ./${installScript}"\n`;
				script += `if [ $? -ne 0 ]; then\n`;
				script += `    echo "Warning: Feature '${featureName}' installation had errors"\n`;
				script += `fi\n\n`;
			}
		}
	}

	script += `${echoCmd} "==> Features installation complete"\n\n`;

	return script;
}

/**
 * Cleans up temporary features directory
 */
export async function cleanupFeaturesDir(featuresDir: string): Promise<void> {
	const logger = getLogger();
	try {
		await rmLocal(featuresDir, { recursive: true, force: true });
		logger.debug(`Cleaned up features directory: ${featuresDir}`);
	} catch (error) {
		logger.warn('Failed to cleanup features directory:', error);
	}
}
