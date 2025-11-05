import { Argv } from 'yargs';
import { UnpackArgv } from './devContainersSpecCLI';
import { dockerComposeCLIConfig } from './dockerCompose';
import { Log, LogLevel, mapLogLevel } from '../spec-utils/log';
import { createLog } from './devContainers';
import { getPackageConfig } from '../spec-utils/product';
import { DockerCLIParameters } from '../spec-shutdown/dockerUtils';
import path from 'path';
import { CLIHost, getCLIHost } from '../spec-common/cliHost';
import { loadNativeModule } from '../spec-common/commonUtils';
import { URI } from 'vscode-uri';
import { Workspace, workspaceFromPath } from '../spec-utils/workspaces';
import { getDefaultDevContainerConfigPath, getDevContainerConfigPathIn, uriToFsPath } from '../spec-configuration/configurationCommonUtils';
import { readDevContainerConfigFile } from './configContainer';
import { ContainerError } from '../spec-common/errors';
import { getCacheFolder, runAsyncHandler } from './utils';
import { Lockfile, generateLockfile, getLockfilePath, writeLockfile } from '../spec-configuration/lockfile';
import { isLocalFile, readLocalFile, writeLocalFile } from '../spec-utils/pfs';
import { readFeaturesConfig } from './featureUtils';
import { DevContainerConfig } from '../spec-configuration/configuration';
import { mapNodeArchitectureToGOARCH, mapNodeOSToGOOS } from '../spec-configuration/containerCollectionsOCI';

export function featuresUpgradeOptions(y: Argv) {
	return y
		.options({
			'workspace-folder': { type: 'string', description: 'Workspace folder.', demandOption: true },
			'docker-path': { type: 'string', description: 'Path to docker executable.', default: 'docker' },
			'docker-compose-path': { type: 'string', description: 'Path to docker-compose executable.', default: 'docker-compose' },
			'config': { type: 'string', description: 'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.' },
			'log-level': { choices: ['error' as 'error', 'info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'dry-run': { type: 'boolean', description: 'Write generated lockfile to standard out instead of to disk.' },
			// Added for dependabot
			'feature': { hidden: true, type: 'string', alias: 'f', description: 'Upgrade the version requirements of a given Feature (and its dependencies).  Then, upgrade the lockfile.   Must supply \'--target-version\'.' },
			'target-version': { hidden: true, type: 'string', alias: 'v', description: 'The major (x), minor (x.y), or patch version (x.y.z) of the Feature to pin in devcontainer.json.  Must supply a \'--feature\'.' },
		})
		.check(argv => {
			if (argv.feature && !argv['target-version'] || !argv.feature && argv['target-version']) {
				throw new Error('The \'--target-version\' and \'--feature\' flag must be used together.');
			}

			if (argv['target-version']) {
				const targetVersion = argv['target-version'];
				if (!targetVersion.match(/^\d+(\.\d+(\.\d+)?)?$/)) {
					throw new Error(`Invalid version '${targetVersion}'.  Must be in the form of 'x', 'x.y', or 'x.y.z'`);
				}
			}
			return true;
		});
}

export type FeaturesUpgradeArgs = UnpackArgv<ReturnType<typeof featuresUpgradeOptions>>;

export function featuresUpgradeHandler(args: FeaturesUpgradeArgs) {
	runAsyncHandler(featuresUpgrade.bind(null, args));
}

async function featuresUpgrade({
	'workspace-folder': workspaceFolderArg,
	'docker-path': dockerPath,
	config: configArg,
	'docker-compose-path': dockerComposePath,
	'log-level': inputLogLevel,
	'dry-run': dryRun,
	feature: feature,
	'target-version': targetVersion,
}: FeaturesUpgradeArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};
	let output: Log | undefined;
	try {
		const workspaceFolder = path.resolve(process.cwd(), workspaceFolderArg);
		const configFile = configArg ? URI.file(path.resolve(process.cwd(), configArg)) : undefined;
		const cliHost = await getCLIHost(workspaceFolder, loadNativeModule, true);
		const extensionPath = path.join(__dirname, '..', '..');
		const sessionStart = new Date();
		const pkg = getPackageConfig();
		const output = createLog({
			logLevel: mapLogLevel(inputLogLevel),
			logFormat: 'text',
			log: text => process.stderr.write(text),
			terminalDimensions: undefined,
		}, pkg, sessionStart, disposables);
		const dockerComposeCLI = dockerComposeCLIConfig({
			exec: cliHost.exec,
			env: cliHost.env,
			output,
		}, dockerPath, dockerComposePath);
		const dockerParams: DockerCLIParameters = {
			cliHost,
			dockerCLI: dockerPath,
			dockerComposeCLI,
			env: cliHost.env,
			output,
			platformInfo: {
				os: mapNodeOSToGOOS(cliHost.platform),
				arch: mapNodeArchitectureToGOARCH(cliHost.arch),
			}
		};

		const workspace = workspaceFromPath(cliHost.path, workspaceFolder);
		const configPath = configFile ? configFile : await getDevContainerConfigPathIn(cliHost, workspace.configFolderPath);
		let config = await getConfig(configPath, cliHost, workspace, output, configFile);
		const cacheFolder = await getCacheFolder(cliHost);
		const params = {
			extensionPath,
			cacheFolder,
			cwd: cliHost.cwd,
			output,
			env: cliHost.env,
			skipFeatureAutoMapping: false,
			platform: cliHost.platform,
		};

		if (feature && targetVersion) {
			output.write(`Updating '${feature}' to '${targetVersion}' in devcontainer.json`, LogLevel.Info);
			// Update Feature version tag in devcontainer.json
			await updateFeatureVersionInConfig(params, config, config.configFilePath!.fsPath, feature, targetVersion);
			// Re-read config for subsequent lockfile generation
			config = await getConfig(configPath, cliHost, workspace, output, configFile);
		}

		const featuresConfig = await readFeaturesConfig(dockerParams, pkg, config, extensionPath, false, {});
		if (!featuresConfig) {
			throw new ContainerError({ description: `Failed to update lockfile` });
		}

		const lockfile: Lockfile = await generateLockfile(featuresConfig);

		if (dryRun) {
			console.log(JSON.stringify(lockfile, null, 2));
			return;
		}

		// Truncate any existing lockfile
		const lockfilePath = getLockfilePath(config);
		await writeLocalFile(lockfilePath, '');
		// Update lockfile
		await writeLockfile(params, config, lockfile, true);
	} catch (err) {
		if (output) {
			output.write(err && (err.stack || err.message) || String(err));
		} else {
			console.error(err);
		}
		await dispose();
		process.exit(1);
	}
	await dispose();
	process.exit(0);
}

async function updateFeatureVersionInConfig(params: { output: Log }, config: DevContainerConfig, configPath: string, targetFeature: string, targetVersion: string) {
	const { output } = params;

	if (!config.features) {
		// No Features in config to upgrade
		output.write(`No Features found in '${configPath}'.`);
		return;
	}

	if (!configPath || !(await isLocalFile(configPath))) {
		throw new ContainerError({ description: `Error running upgrade command.  Config path '${configPath}' does not exist.` });
	}

	const configText = await readLocalFile(configPath);
	const previousConfigText: string = configText.toString();
	let updatedText: string = configText.toString();

	const targetFeatureNoVersion = getFeatureIdWithoutVersion(targetFeature);
	for (const [userFeatureId, _] of Object.entries(config.features)) {
		if (targetFeatureNoVersion !== getFeatureIdWithoutVersion(userFeatureId)) {
			continue;
		}
		updatedText = upgradeFeatureKeyInConfig(updatedText, userFeatureId, `${targetFeatureNoVersion}:${targetVersion}`);
		break;
	}

	output.write(updatedText, LogLevel.Trace);
	if (updatedText === previousConfigText) {
		output.write(`No changes to config file: ${configPath}\n`, LogLevel.Trace);
		return;
	}

	output.write(`Updating config file: '${configPath}'`, LogLevel.Info);
	await writeLocalFile(configPath, updatedText);
}

function upgradeFeatureKeyInConfig(configText: string, current: string, updated: string) {
	const featureIdRegex = new RegExp(current, 'g');
	return configText.replace(featureIdRegex, updated);
}

async function getConfig(configPath: URI | undefined, cliHost: CLIHost, workspace: Workspace, output: Log, configFile: URI | undefined): Promise<DevContainerConfig> {
	const configs = configPath && await readDevContainerConfigFile(cliHost, workspace, configPath, true, output) || undefined;
	if (!configs) {
		throw new ContainerError({ description: `Dev container config (${uriToFsPath(configFile || getDefaultDevContainerConfigPath(cliHost, workspace!.configFolderPath), cliHost.platform)}) not found.` });
	}
	return configs.config.config;
}

const lastDelimiter = /[:@][^/]*$/;
function getFeatureIdWithoutVersion(featureId: string) {
	const m = lastDelimiter.exec(featureId);
	return m ? featureId.substring(0, m.index) : featureId;
}
