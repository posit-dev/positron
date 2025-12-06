import { Argv } from 'yargs';
import { UnpackArgv } from '../devContainersSpecCLI';
import { generateTemplatesDocumentation } from '../collectionCommonUtils/generateDocsCommandImpl';
import { createLog } from '../devContainers';
import { mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { runAsyncHandler } from '../utils';

// -- 'templates generate-docs' command
export function templatesGenerateDocsOptions(y: Argv) {
	return y
		.options({
			'project-folder': { type: 'string', alias: 'p', default: '.', description: 'Path to folder containing \'src\' and \'test\' sub-folders. This is likely the git root of the project.' },
			'github-owner': { type: 'string', default: '', description: `GitHub owner for docs.` },
			'github-repo': { type: 'string', default: '', description: `GitHub repo for docs.` },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
		})
		.check(_argv => {
			return true;
		});
}

export type TemplatesGenerateDocsArgs = UnpackArgv<ReturnType<typeof templatesGenerateDocsOptions>>;

export function templatesGenerateDocsHandler(args: TemplatesGenerateDocsArgs) {
	runAsyncHandler(templatesGenerateDocs.bind(null, args));
}

export async function templatesGenerateDocs({
	'project-folder': collectionFolder,
	'github-owner': gitHubOwner,
	'github-repo': gitHubRepo,
	'log-level': inputLogLevel,
}: TemplatesGenerateDocsArgs) {
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

	await generateTemplatesDocumentation(collectionFolder, gitHubOwner, gitHubRepo, output);

	// Cleanup
	await dispose();
	process.exit();
}
