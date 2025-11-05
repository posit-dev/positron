import { Argv } from 'yargs';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { doFeaturesPackageCommand } from './packageCommandImpl';
import { PackageCommandInput, PackageOptions } from '../collectionCommonUtils/package';
import { runAsyncHandler } from '../utils';

export function featuresPackageOptions(y: Argv) {
	return PackageOptions(y, 'feature');
}

export type FeaturesPackageArgs = UnpackArgv<ReturnType<typeof featuresPackageOptions>>;
export function featuresPackageHandler(args: FeaturesPackageArgs) {
	runAsyncHandler(featuresPackage.bind(null, args));
}

async function featuresPackage({
	'target': targetFolder,
	'log-level': inputLogLevel,
	'output-folder': outputDir,
	'force-clean-output-folder': forceCleanOutputDir,
}: FeaturesPackageArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const pkg = getPackageConfig();

	const cwd = process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule, true);
	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stderr.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables);


	const args: PackageCommandInput = {
		cliHost,
		targetFolder,
		outputDir,
		output,
		disposables,
		forceCleanOutputDir: forceCleanOutputDir
	};

	const exitCode = !!(await doFeaturesPackageCommand(args)) ? 0 : 1;

	await dispose();
	process.exit(exitCode);
}
