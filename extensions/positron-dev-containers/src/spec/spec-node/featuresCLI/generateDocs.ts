import { Argv } from 'yargs';
import { UnpackArgv } from '../devContainersSpecCLI';
import { generateFeaturesDocumentation } from '../collectionCommonUtils/generateDocsCommandImpl';
import { createLog } from '../devContainers';
import { mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { runAsyncHandler } from '../utils';

// -- 'features generate-docs' command
export function featuresGenerateDocsOptions(y: Argv) {
	return y
		.options({
			'project-folder': { type: 'string', alias: 'p', default: '.', description: 'Path to folder containing \'src\' and \'test\' sub-folders. This is likely the git root of the project.' },
			'registry': { type: 'string', alias: 'r', default: 'ghcr.io', description: 'Name of the OCI registry.' },
			'namespace': { type: 'string', alias: 'n', require: true, description: `Unique indentifier for the collection of features. Example: <owner>/<repo>` },
			'github-owner': { type: 'string', default: '', description: `GitHub owner for docs.` },
			'github-repo': { type: 'string', default: '', description: `GitHub repo for docs.` },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
		})
		.check(_argv => {
			return true;
		});
}

export type FeaturesGenerateDocsArgs = UnpackArgv<ReturnType<typeof featuresGenerateDocsOptions>>;

export function featuresGenerateDocsHandler(args: FeaturesGenerateDocsArgs) {
	runAsyncHandler(featuresGenerateDocs.bind(null, args));
}

export async function featuresGenerateDocs({
	'project-folder': collectionFolder,
	'registry': registry,
	'namespace': namespace,
	'github-owner': gitHubOwner,
	'github-repo': gitHubRepo,
	'log-level': inputLogLevel,
}: FeaturesGenerateDocsArgs) {
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

	await generateFeaturesDocumentation(collectionFolder, registry, namespace, gitHubOwner, gitHubRepo, output);

	// Cleanup
	await dispose();
	process.exit();
}
