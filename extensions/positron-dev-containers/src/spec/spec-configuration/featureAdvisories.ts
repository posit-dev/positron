/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FeatureSet, FeaturesConfig, OCISourceInformation } from './containerFeaturesConfiguration';
import { FeatureAdvisory, getControlManifest } from './controlManifest';
import { parseVersion, isEarlierVersion } from '../spec-common/commonUtils';
import { Log, LogLevel } from '../spec-utils/log';

export async function fetchFeatureAdvisories(params: { cacheFolder: string; output: Log }, featuresConfig: FeaturesConfig) {

	const features = featuresConfig.featureSets
		.map(f => [f, f.sourceInformation] as const)
		.filter((tup): tup is [FeatureSet, OCISourceInformation] => tup[1].type === 'oci')
		.map(([set, source]) => ({
			id: `${source.featureRef.registry}/${source.featureRef.path}`,
			version: set.features[0].version!,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
	if (!features.length) {
		return [];
	}

	const controlManifest = await getControlManifest(params.cacheFolder, params.output);
	if (!controlManifest.featureAdvisories.length) {
		return [];
	}

	const featureAdvisories = controlManifest.featureAdvisories.reduce((acc, cur) => {
		const list = acc.get(cur.featureId);
		if (list) {
			list.push(cur);
		} else {
			acc.set(cur.featureId, [cur]);
		}
		return acc;
	}, new Map<string, FeatureAdvisory[]>());

	const parsedVersions = new Map<string, number[] | undefined>();
	function lookupParsedVersion(version: string) {
		if (!parsedVersions.has(version)) {
			parsedVersions.set(version, parseVersion(version));
		}
		return parsedVersions.get(version);
	}
	const featuresWithAdvisories = features.map(feature => {
		const advisories = featureAdvisories.get(feature.id);
		const featureVersion = lookupParsedVersion(feature.version);
		if (!featureVersion) {
			params.output.write(`Unable to parse version for feature ${feature.id}: ${feature.version}`, LogLevel.Warning);
			return {
				feature,
				advisories: [],
			};
		}
		return {
			feature,
			advisories: advisories?.filter(advisory => {
				const introducedInVersion = lookupParsedVersion(advisory.introducedInVersion);
				const fixedInVersion = lookupParsedVersion(advisory.fixedInVersion);
				if (!introducedInVersion || !fixedInVersion) {
					return false;
				}
				return !isEarlierVersion(featureVersion, introducedInVersion) && isEarlierVersion(featureVersion, fixedInVersion);
			}) || [],
		};
	}).filter(f => f.advisories.length);

	return featuresWithAdvisories;
}

export async function logFeatureAdvisories(params: { cacheFolder: string; output: Log }, featuresConfig: FeaturesConfig) {

	const featuresWithAdvisories = await fetchFeatureAdvisories(params, featuresConfig);
	if (!featuresWithAdvisories.length) {
		return;
	}

	params.output.write(`

-----------------------------------------------------------------------------------------------------------
FEATURE ADVISORIES:${featuresWithAdvisories.map(f => `
- ${f.feature.id}:${f.feature.version}:${f.advisories.map(a => `
  - ${a.description} (introduced in ${a.introducedInVersion}, fixed in ${a.fixedInVersion}${a.documentationURL ? `, see ${a.documentationURL}` : ''})`)
  .join('')}`)
.join('')}

It is recommended that you update your configuration to versions of these features with the fixes applied.
-----------------------------------------------------------------------------------------------------------

`, LogLevel.Warning);
}
