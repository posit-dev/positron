/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DevContainerConfig } from '../spec-configuration/configuration';
import { ContainerError } from '../spec-common/errors';
import { DockerCLIParameters, dockerCLI } from '../spec-shutdown/dockerUtils';
import { findDevContainer } from './singleContainer';
import { DevContainerControlManifest, DisallowedFeature, getControlManifest } from '../spec-configuration/controlManifest';
import { getCacheFolder } from './utils';


export async function ensureNoDisallowedFeatures(params: DockerCLIParameters, config: DevContainerConfig, additionalFeatures: Record<string, string | boolean | Record<string, string | boolean>>, idLabels: string[] | undefined) {
	const controlManifest = await getControlManifest(await getCacheFolder(params.cliHost), params.output);
	const disallowed = Object.keys({
		...config.features,
		...additionalFeatures,
	}).map(configFeatureId => {
		const disallowedFeatureEntry = findDisallowedFeatureEntry(controlManifest, configFeatureId);
		return disallowedFeatureEntry ? { configFeatureId, disallowedFeatureEntry } : undefined;
	}).filter(Boolean) as {
		configFeatureId: string;
		disallowedFeatureEntry: DisallowedFeature;
	}[];

	if (!disallowed.length) {
		return;
	}

	let stopped = false;
	if (idLabels) {
		const container = await findDevContainer(params, idLabels);
		if (container?.State?.Status === 'running') {
			await dockerCLI(params, 'stop', '-t', '0', container.Id);
			stopped = true;
		}
	}

	const d = disallowed[0]!;
	const documentationURL = d.disallowedFeatureEntry.documentationURL;
	throw new ContainerError({
		description: `Cannot use the '${d.configFeatureId}' Feature since it was reported to be problematic. Please remove this Feature from your configuration and rebuild any dev container using it before continuing.${stopped ? ' The existing dev container was stopped.' : ''}${documentationURL ? ` See ${documentationURL} to learn more.` : ''}`,
		data: {
			disallowedFeatureId: d.configFeatureId,
			didStopContainer: stopped,
			learnMoreUrl: documentationURL,
		},
	});
}

export function findDisallowedFeatureEntry(controlManifest: DevContainerControlManifest, featureId: string): DisallowedFeature | undefined {
	return controlManifest.disallowedFeatures.find(
		disallowedFeature =>
			featureId.startsWith(disallowedFeature.featureIdPrefix) &&
			(featureId.length === disallowedFeature.featureIdPrefix.length || // Feature id equal to prefix.
				'/:@'.indexOf(featureId[disallowedFeature.featureIdPrefix.length]) !== -1) // Feature id with prefix and continued by separator.
	);
}
