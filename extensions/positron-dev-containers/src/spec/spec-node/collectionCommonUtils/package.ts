import { Argv } from 'yargs';
import { CLIHost } from '../../spec-common/cliHost';
import { Log } from '../../spec-utils/log';

const targetPositionalDescription = (collectionType: string) => `
Package ${collectionType}s at provided [target] (default is cwd), where [target] is either:
   1. A path to the src folder of the collection with [1..n] ${collectionType}s.
   2. A path to a single ${collectionType} that contains a devcontainer-${collectionType}.json.
   
   Additionally, a 'devcontainer-collection.json' will be generated in the output directory.
`;

export function PackageOptions(y: Argv, collectionType: string) {
	return y
		.options({
			'output-folder': { type: 'string', alias: 'o', default: './output', description: 'Path to output directory. Will create directories as needed.' },
			'force-clean-output-folder': { type: 'boolean', alias: 'f', default: false, description: 'Automatically delete previous output directory before packaging' },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
		})
		.positional('target', { type: 'string', default: '.', description: targetPositionalDescription(collectionType) })
		.check(_argv => {
			return true;
		});
}

export interface PackageCommandInput {
	cliHost: CLIHost;
	targetFolder: string;
	outputDir: string;
	output: Log;
	disposables: (() => Promise<unknown> | undefined)[];
	isSingle?: boolean; // Packaging a collection of many features/templates. Should autodetect.
	forceCleanOutputDir?: boolean;
}
