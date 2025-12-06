import path from 'path';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { LogLevel } from '../../spec-utils/log';
import { writeLocalFile } from '../../spec-utils/pfs';
import { PackageCommandInput } from '../collectionCommonUtils/package';
import { SourceInformation, prepPackageCommand, packageCollection, packageSingleFeatureOrTemplate, OCICollectionFileName } from '../collectionCommonUtils/packageCommandImpl';

interface DevContainerCollectionMetadata {
	sourceInformation: SourceInformation;
	features: Feature[];
}

const collectionType = 'feature';

export async function doFeaturesPackageCommand(args: PackageCommandInput): Promise<DevContainerCollectionMetadata | undefined> {
	args = await prepPackageCommand(args, collectionType);
	const { output, outputDir } = args;
	const isSingleFeature = args.isSingle;

	// For each feature, package each feature and write to 'outputDir/{f}.tgz'
	// Returns an array of feature metadata from each processed feature

	let metadataOutput: Feature[] | undefined = [];
	if (isSingleFeature) {
		// Package individual features
		output.write('Packaging single feature...', LogLevel.Info);
		metadataOutput = await packageSingleFeature(args);
	} else {
		output.write('Packaging feature collection...', LogLevel.Info);
		metadataOutput = await packageFeatureCollection(args);
	}

	if (!metadataOutput) {
		output.write('Failed to package features', LogLevel.Error);
		return undefined;
	}

	const collection: DevContainerCollectionMetadata = {
		sourceInformation: {
			source: 'devcontainer-cli',
		},
		features: metadataOutput,
	};

	// Write the metadata to a file
	const metadataOutputPath = path.join(outputDir, OCICollectionFileName);
	await writeLocalFile(metadataOutputPath, JSON.stringify(collection, null, 4));
	return collection;
}

export async function packageSingleFeature(args: PackageCommandInput): Promise<Feature[] | undefined> {
	return await packageSingleFeatureOrTemplate(args, collectionType);
}

export async function packageFeatureCollection(args: PackageCommandInput): Promise<Feature[] | undefined> {
	return await packageCollection(args, collectionType);
}
