import { Log, LogLevel } from '../spec-utils/log';
import { Feature, FeatureSet } from './containerFeaturesConfiguration';
import { CommonParams, fetchOCIManifestIfExists, getBlob, getRef, ManifestContainer } from './containerCollectionsOCI';

export function tryGetOCIFeatureSet(output: Log, identifier: string, options: boolean | string | Record<string, boolean | string | undefined>, manifest: ManifestContainer, originalUserFeatureId: string): FeatureSet | undefined {
	const featureRef = getRef(output, identifier);
	if (!featureRef) {
		output.write(`Unable to parse '${identifier}'`, LogLevel.Error);
		return undefined;
	}

	const feat: Feature = {
		id: featureRef.id,
		included: true,
		value: options
	};

	const userFeatureIdWithoutVersion = getFeatureIdWithoutVersion(originalUserFeatureId);
	let featureSet: FeatureSet = {
		sourceInformation: {
			type: 'oci',
			manifest: manifest.manifestObj,
			manifestDigest: manifest.contentDigest,
			featureRef: featureRef,
			userFeatureId: originalUserFeatureId,
			userFeatureIdWithoutVersion

		},
		features: [feat],
	};

	return featureSet;
}

const lastDelimiter = /[:@][^/]*$/;
export function getFeatureIdWithoutVersion(featureId: string) {
	const m = lastDelimiter.exec(featureId);
	return m ? featureId.substring(0, m.index) : featureId;
}

export async function fetchOCIFeatureManifestIfExistsFromUserIdentifier(params: CommonParams, identifier: string, manifestDigest?: string): Promise<ManifestContainer | undefined> {
	const { output } = params;

	const featureRef = getRef(output, identifier);
	if (!featureRef) {
		return undefined;
	}
	return await fetchOCIManifestIfExists(params, featureRef, manifestDigest);
}

// Download a feature from which a manifest was previously downloaded.
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-blobs
export async function fetchOCIFeature(params: CommonParams, featureSet: FeatureSet, ociCacheDir: string, featCachePath: string, metadataFile?: string) {
	const { output } = params;

	if (featureSet.sourceInformation.type !== 'oci') {
		output.write(`FeatureSet is not an OCI featureSet.`, LogLevel.Error);
		throw new Error('FeatureSet is not an OCI featureSet.');
	}

	const { featureRef } = featureSet.sourceInformation;

	const layerDigest = featureSet.sourceInformation.manifest?.layers[0].digest;
	const blobUrl = `https://${featureSet.sourceInformation.featureRef.registry}/v2/${featureSet.sourceInformation.featureRef.path}/blobs/${layerDigest}`;
	output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

	const blobResult = await getBlob(params, blobUrl, ociCacheDir, featCachePath, featureRef, layerDigest, undefined, metadataFile);

	if (!blobResult) {
		throw new Error(`Failed to download package for ${featureSet.sourceInformation.featureRef.resource}`);
	}

	return blobResult;
}
