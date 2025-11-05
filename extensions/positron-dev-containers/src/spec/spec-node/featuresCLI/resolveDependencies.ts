import * as path from 'path';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { isLocalFile } from '../../spec-utils/pfs';
import { DevContainerFeature } from '../../spec-configuration/configuration';
import { buildDependencyGraph, computeDependsOnInstallationOrder, generateMermaidDiagram } from '../../spec-configuration/containerFeaturesOrder';
import { OCISourceInformation, processFeatureIdentifier, userFeaturesToArray } from '../../spec-configuration/containerFeaturesConfiguration';
import { readLockfile } from '../../spec-configuration/lockfile';
import { runAsyncHandler } from '../utils';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { getCLIHost } from '../../spec-common/cliHost';
import { ContainerError } from '../../spec-common/errors';
import { uriToFsPath } from '../../spec-configuration/configurationCommonUtils';
import { workspaceFromPath } from '../../spec-utils/workspaces';
import { readDevContainerConfigFile } from '../configContainer';
import { URI } from 'vscode-uri';


interface JsonOutput {
	installOrder?: {
		id: string;
		options: string | boolean | Record<string, string | boolean | undefined>;
	}[];
}

export function featuresResolveDependenciesOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['error' as 'error', 'info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'error' as 'error', description: 'Log level.' },
			'workspace-folder': { type: 'string', description: 'Workspace folder to use for the configuration.', demandOption: true },
		});
}

export type featuresResolveDependenciesArgs = UnpackArgv<ReturnType<typeof featuresResolveDependenciesOptions>>;

export function featuresResolveDependenciesHandler(args: featuresResolveDependenciesArgs) {
	runAsyncHandler(featuresResolveDependencies.bind(null, args));
}

async function featuresResolveDependencies({
	'workspace-folder': workspaceFolder,
	'log-level': inputLogLevel,
}: featuresResolveDependenciesArgs) {
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
	}, pkg, new Date(), disposables, true);

	// const params = { output, env: process.env, outputFormat };

	let jsonOutput: JsonOutput = {};

	// Detect path to dev container config
	let configPath = path.join(workspaceFolder, '.devcontainer.json');
	if (!(await isLocalFile(configPath))) {
		configPath = path.join(workspaceFolder, '.devcontainer', 'devcontainer.json');
	}

	const params = {
		output,
		env: process.env,
	};

	const cwd = workspaceFolder || process.cwd();
	const cliHost = await getCLIHost(cwd, loadNativeModule, true);
	const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
	const configFile: URI = URI.file(path.resolve(process.cwd(), configPath));
	const configs = await readDevContainerConfigFile(cliHost, workspace, configFile, false, output, undefined, undefined);	

	if (configFile && !configs) {
		throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile, cliHost.platform)}) not found.` });
	}
	const configWithRaw = configs!.config;
	const { config } = configWithRaw;

	const userFeaturesConfig = userFeaturesToArray(config);
	if (!userFeaturesConfig) {
		output.write(`Could not parse features object in configuration '${configPath}'`, LogLevel.Error);
		process.exit(1);
	}

	const { lockfile } = await readLockfile(config);
	const processFeature = async (_userFeature: DevContainerFeature) => {
		return await processFeatureIdentifier(params, configPath, workspaceFolder, _userFeature, lockfile);
	};

	const graph = await buildDependencyGraph(params, processFeature, userFeaturesConfig, config, lockfile);
	const worklist = graph?.worklist!;
	console.log(generateMermaidDiagram(params, worklist));

	const installOrder = await computeDependsOnInstallationOrder(params, processFeature, userFeaturesConfig, config, lockfile, graph);

	if (!installOrder) {
		// Bold
		output.write(`\u001b[1mNo viable installation order!\u001b[22m`, LogLevel.Error);
		process.exit(1);
	}

	// Output the install order, if one exists.
	// JSON
	jsonOutput = {
		...jsonOutput,
		installOrder: installOrder.map(f => {
			const sourceInfo = f?.sourceInformation;
			switch (sourceInfo.type) {
				case 'oci':
					const featureRef = (sourceInfo as OCISourceInformation).featureRef;
					return {
						id: `${featureRef.resource}@${sourceInfo.manifestDigest}`,
						options: f?.features[0].value
					};
				default:
					return {
						id: f.sourceInformation.userFeatureId,
						options: f?.features[0].value
					};
			}
		})
	};


	console.log(JSON.stringify(jsonOutput, undefined, 2));
	await dispose();
	process.exit();
}