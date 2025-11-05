import { DevContainerConfig } from '../spec-configuration/configuration';
import { FeaturesConfig, generateFeaturesConfig } from '../spec-configuration/containerFeaturesConfiguration';
import { DockerCLIParameters } from '../spec-shutdown/dockerUtils';
import { PackageConfiguration } from '../spec-utils/product';
import { createFeaturesTempFolder, getCacheFolder } from './utils';

export async function readFeaturesConfig(params: DockerCLIParameters, pkg: PackageConfiguration, config: DevContainerConfig, extensionPath: string, skipFeatureAutoMapping: boolean, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>): Promise<FeaturesConfig | undefined> {
	const { cliHost, output } = params;
	const { cwd, env, platform } = cliHost;
	const featuresTmpFolder = await createFeaturesTempFolder({ cliHost, package: pkg });
	const cacheFolder = await getCacheFolder(cliHost);
	return generateFeaturesConfig({ extensionPath, cacheFolder, cwd, output, env, skipFeatureAutoMapping, platform }, featuresTmpFolder, config, additionalFeatures);
}