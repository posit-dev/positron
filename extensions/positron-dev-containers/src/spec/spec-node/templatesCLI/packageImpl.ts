import path from 'path';
import { OCICollectionFileName, packageCollection, packageSingleFeatureOrTemplate, prepPackageCommand, SourceInformation } from '../collectionCommonUtils/packageCommandImpl';
import { Template } from '../../spec-configuration/containerTemplatesConfiguration';
import { PackageCommandInput } from '../collectionCommonUtils/package';
import { LogLevel } from '../../spec-utils/log';
import { writeLocalFile } from '../../spec-utils/pfs';

export interface DevContainerCollectionMetadata {
	sourceInformation: SourceInformation;
	templates: Template[];
}

const collectionType = 'template';

export async function packageTemplates(args: PackageCommandInput): Promise<DevContainerCollectionMetadata | undefined> {
	args = await prepPackageCommand(args, collectionType);
	const { output, outputDir } = args;
	const isSingleTemplate = args.isSingle;

	// For each template, package each template and write to 'outputDir/{f}.tgz'
	// Returns an array of template metadata from each processed template

	let metadataOutput: Template[] | undefined = [];
	if (isSingleTemplate) {
		// Package individual templates
		output.write('Packaging single template...', LogLevel.Info);
		metadataOutput = await packageSingleTemplate(args);
	} else {
		output.write('Packaging template collection...', LogLevel.Info);
		metadataOutput = await packageTemplateCollection(args);
	}

	if (!metadataOutput) {
		output.write('Failed to package templates', LogLevel.Error);
		return undefined;
	}

	const collection: DevContainerCollectionMetadata = {
		sourceInformation: {
			source: 'devcontainer-cli',
		},
		templates: metadataOutput,
	};

	// Write the metadata to a file
	const metadataOutputPath = path.join(outputDir, OCICollectionFileName);
	await writeLocalFile(metadataOutputPath, JSON.stringify(collection, null, 4));
	return collection;
}

export async function packageSingleTemplate(args: PackageCommandInput): Promise<Template[] | undefined> {
	return await packageSingleFeatureOrTemplate(args, collectionType);
}

export async function packageTemplateCollection(args: PackageCommandInput): Promise<Template[] | undefined> {
	return await packageCollection(args, collectionType);
}
