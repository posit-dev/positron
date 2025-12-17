import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { fetchOCIManifestIfExists, getRef } from '../../spec-configuration/containerCollectionsOCI';

import { UnpackArgv } from '../devContainersSpecCLI';
import { runAsyncHandler } from '../utils';

export function templateMetadataOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
		})
		.positional('templateId', { type: 'string', demandOption: true, description: 'Template Identifier' });
}

export type TemplateMetadataArgs = UnpackArgv<ReturnType<typeof templateMetadataOptions>>;

export function templateMetadataHandler(args: TemplateMetadataArgs) {
	runAsyncHandler(templateMetadata.bind(null, args));
}

async function templateMetadata({
	'log-level': inputLogLevel,
	'templateId': templateId,
}: TemplateMetadataArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const pkg = getPackageConfig();

	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stderr.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables);

	const params = { output, env: process.env };
	output.write(`Fetching metadata for ${templateId}`, LogLevel.Trace);

	const templateRef = getRef(output, templateId);
	if (!templateRef) {
		console.log(JSON.stringify({}));
		process.exit(1);
	}

	const manifestContainer = await fetchOCIManifestIfExists(params, templateRef, undefined);
	if (!manifestContainer) {
		console.log(JSON.stringify({}));
		process.exit(1);
	}

	const { manifestObj, canonicalId } = manifestContainer;
	output.write(`Template '${templateId}' resolved to '${canonicalId}'`, LogLevel.Trace);

	// Templates must have been published with a CLI post commit
	// https://github.com/devcontainers/cli/commit/6c6aebfa7b74aea9d67760fd1e74b09573d31536
	// in order to contain attached metadata.
	const metadata = manifestObj.annotations?.['dev.containers.metadata'];
	if (!metadata) {
		output.write(`Template resolved to '${canonicalId}' but does not contain metadata on its manifest.`, LogLevel.Warning);
		output.write(`Ask the Template owner to republish this Template to populate the manifest.`, LogLevel.Warning);
		console.log(JSON.stringify({}));
		process.exit(1);
	}

	const unescaped = JSON.parse(metadata);
	console.log(JSON.stringify(unescaped));
	await dispose();
	process.exit();
}
