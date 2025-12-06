import path from 'path';
import * as semver from 'semver';
import { Log, LogLevel } from '../../spec-utils/log';
import { CommonParams, getPublishedTags, OCICollectionRef, OCIRef } from '../../spec-configuration/containerCollectionsOCI';
import { OCICollectionFileName } from './packageCommandImpl';
import { pushCollectionMetadata, pushOCIFeatureOrTemplate } from '../../spec-configuration/containerCollectionsOCIPush';

let semanticVersions: string[] = [];
function updateSemanticTagsList(publishedTags: string[], version: string, range: string, publishVersion: string) {
	// Reference: https://github.com/npm/node-semver#ranges-1
	const publishedMaxVersion = semver.maxSatisfying(publishedTags, range);
	if (publishedMaxVersion === null || semver.compare(version, publishedMaxVersion) === 1) {
		semanticVersions.push(publishVersion);
	}
	return;
}

export function getSemanticTags(version: string, tags: string[], output: Log) {
	if (tags.includes(version)) {
		output.write(`(!) WARNING: Version ${version} already exists, skipping ${version}...`, LogLevel.Warning);
		return undefined;
	}

	const parsedVersion = semver.parse(version);
	if (!parsedVersion) {
		output.write(`(!) ERR: Version ${version} is not a valid semantic version, skipping ${version}...`, LogLevel.Error);
		process.exit(1);
	}

	semanticVersions = [];

	// Adds semantic versions depending upon the existings (published) versions
	// eg. 1.2.3 --> [1, 1.2, 1.2.3, latest]
	updateSemanticTagsList(tags, version, `${parsedVersion.major}.x.x`, `${parsedVersion.major}`);
	updateSemanticTagsList(tags, version, `${parsedVersion.major}.${parsedVersion.minor}.x`, `${parsedVersion.major}.${parsedVersion.minor}`);
	semanticVersions.push(version);
	updateSemanticTagsList(tags, version, `x.x.x`, 'latest');

	return semanticVersions;
}

export async function doPublishCommand(params: CommonParams, version: string, ociRef: OCIRef, outputDir: string, collectionType: string, archiveName: string, annotations: { [key: string]: string } = {}) {
	const { output } = params;

	output.write(`Fetching published versions...`, LogLevel.Info);
	const publishedTags = await getPublishedTags(params, ociRef);

	if (!publishedTags) {
		return;
	}

	const semanticTags: string[] | undefined = getSemanticTags(version, publishedTags, output);

	if (!!semanticTags) {
		output.write(`Publishing tags: ${semanticTags.toString()}...`, LogLevel.Info);
		const pathToTgz = path.join(outputDir, archiveName);
		const digest = await pushOCIFeatureOrTemplate(params, ociRef, pathToTgz, semanticTags, collectionType, annotations);
		if (!digest) {
			output.write(`(!) ERR: Failed to publish ${collectionType}: '${ociRef.resource}'`, LogLevel.Error);
			return;
		}
		output.write(`Published ${collectionType}: '${ociRef.id}'`, LogLevel.Info);
		return { publishedTags: semanticTags, digest };
	}

	return {}; // Not an error if no versions were published, likely they just already existed and were skipped.
}

export async function doPublishMetadata(params: CommonParams, collectionRef: OCICollectionRef, outputDir: string, collectionType: string): Promise<string | undefined> {
	const { output } = params;

	// Publishing Feature/Template Collection Metadata
	output.write('Publishing collection metadata...', LogLevel.Info);

	const pathToCollectionFile = path.join(outputDir, OCICollectionFileName);
	const publishedDigest = await pushCollectionMetadata(params, collectionRef, pathToCollectionFile, collectionType);
	if (!publishedDigest) {
		output.write(`(!) ERR: Failed to publish collection metadata: ${OCICollectionFileName}`, LogLevel.Error);
		return;
	}
	output.write('Published collection metadata.', LogLevel.Info);
	return publishedDigest;
}
