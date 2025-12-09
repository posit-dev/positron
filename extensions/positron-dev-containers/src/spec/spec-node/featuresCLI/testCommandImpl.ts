import path from 'path';
import chalk from 'chalk';
import { tmpdir } from 'os';
import * as jsonc from 'jsonc-parser';
import { CLIHost } from '../../spec-common/cliHost';
import { launch, ProvisionOptions, createDockerParams } from '../devContainers';
import { doExec } from '../devContainersSpecCLI';
import { LaunchResult, staticExecParams, staticProvisionParams, testLibraryScript } from './utils';
import { DockerResolverParameters } from '../utils';
import { DevContainerConfig } from '../../spec-configuration/configuration';
import { FeaturesTestCommandInput } from './test';
import { cpDirectoryLocal, rmLocal } from '../../spec-utils/pfs';
import { nullLog } from '../../spec-utils/log';
import { runCommandNoPty } from '../../spec-common/commonUtils';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { getSafeId } from '../containerFeatures';

const TEST_LIBRARY_SCRIPT_NAME = 'dev-container-features-test-lib';

function fail(msg: string) {
	log(msg, { prefix: '[-]', error: true });
	process.exit(1);
}

type Scenarios = { [key: string]: DevContainerConfig };
type TestResult = { testName: string; result: boolean };

function log(msg: string, options?: { omitPrefix?: boolean; prefix?: string; info?: boolean; error?: boolean }) {

	const prefix = options?.prefix || '> ';
	const output = `${options?.omitPrefix ? '' : `${prefix} `}${msg}\n`;

	if (options?.error) {
		process.stdout.write(chalk.red(output));
	} else if (options?.info) {
		process.stdout.write(chalk.bold.blue(output));
	} else {
		process.stdout.write(chalk.blue(output));
	}
}

export async function doFeaturesTestCommand(args: FeaturesTestCommandInput): Promise<number> {
	const { pkg, globalScenariosOnly, features, collectionFolder, cliHost } = args;

	process.stdout.write(`
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
|    Dev Container Features   |   
│           v${pkg.version}           │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘\n\n`);


	const srcDir = `${collectionFolder}/src`;
	const testsDir = `${collectionFolder}/test`;

	if (! await cliHost.isFolder(srcDir) || ! await cliHost.isFolder(testsDir)) {
		fail(`Folder '${collectionFolder}' does not contain the required 'src' and 'test' folders.`);
	}

	let testResults: TestResult[] = [];
	if (globalScenariosOnly) {
		await runGlobalFeatureTests(args, testResults);
	} else {
		await runFeatureTests(args, testResults);

		// If any features were explicitly set to run,
		// we know we don't want to run the global tests.
		if (!features) {
			await runGlobalFeatureTests(args, testResults);
		}
	}

	// Clean up test containers
	if (!args.preserveTestContainers) {
		await cleanup(cliHost);
	}

	// Pretty-print test results and exit with 0 or 1 exit code.
	return analyzeTestResults(testResults);
}

async function cleanup(cliHost: CLIHost) {
	// Delete any containers that have the 'devcontainer.is_test_run=true' label set.
	const filterForContainerIdArgs = ['ps', '-a', '--filter', 'label=devcontainer.is_test_run=true', '--format', '{{.ID}}'];
	const { stdout } = (await runCommandNoPty({ cmd: 'docker', args: filterForContainerIdArgs, output: nullLog, exec: cliHost.exec }));
	const containerIds = stdout.toString().split('\n').filter(id => id !== '').map(s => s.trim());
	log(`Cleaning up ${containerIds.length} test containers...`, { prefix: '🧹', info: true });
	for (const containerId of containerIds) {
		log(`Removing container ${containerId}...`, { prefix: '🧹', info: true });
		await cliHost.exec({ cmd: 'docker', args: ['rm', '-f', containerId], output: nullLog });
	}
}

async function runGlobalFeatureTests(args: FeaturesTestCommandInput, testResults: TestResult[] = []): Promise<TestResult[]> {
	const { collectionFolder } = args;

	const globalTestsFolder = `${collectionFolder}/test/_global`;

	log(`Scenarios:         ${globalTestsFolder}\n`, { prefix: '\n📊', info: true });
	testResults = await doScenario(globalTestsFolder, '_global', args, testResults);
	if (!testResults) {
		fail(`Failed to run scenarios in ${globalTestsFolder}`);
		return []; // We never reach here, we exit via fail().
	}

	return testResults;
}

// Executes the same Feature twice with randomized options to ensure Feature can be installed >1.
async function runDuplicateTest(args: FeaturesTestCommandInput, feature: string, testResults: TestResult[] = []): Promise<TestResult[]> {
	const { collectionFolder, cliHost } = args;
	const scenarioName = `${feature} executed twice with randomized options`;

	const featureTestFolder = path.join(collectionFolder, 'test', feature);
	const testFileName = 'duplicate.sh';
	const testFilePath = path.join(featureTestFolder, testFileName);
	if (!(await cliHost.isFile(testFilePath))) {
		log(`Skipping duplicate test for ${feature} because '${testFilePath}' does not exist.`, { prefix: '⚠️', });
		return testResults;
	}

	//Read Feature's metadata
	const featureMetadata = await readFeatureMetadata(args, feature);
	const options = featureMetadata.options || {};

	// For each possible option, generate a random value for each Feature
	const nonDefaultOptions: { [key: string]: string | boolean } = {};
	Object.entries(options).forEach(([key, value]) => {
		if (value.type === 'boolean') {
			nonDefaultOptions[key] = !value.default;
		}
		if (value.type === 'string' && 'proposals' in value && value?.proposals?.length) {

			// Get an index for the default value
			let defaultValueIdx = value.default ? value.proposals.indexOf(value.default) : 0;
			let idx = 0;
			if (args.permitRandomization) {
				// Select a random value that isn't the default
				idx = Math.floor(Math.random() * value.proposals.length);
			}

			if (idx === defaultValueIdx) {
				idx = (idx + 1) % value.proposals.length;
			}

			nonDefaultOptions[key] = value.proposals[idx];
		}
		if (value.type === 'string' && 'enum' in value && value?.enum?.length) {
			// Get an index for the default value
			let defaultValueIdx = value.default ? value.enum.indexOf(value.default) : 0;
			let idx = 0;
			if (args.permitRandomization) {
				// Select a random value that isn't the default
				idx = Math.floor(Math.random() * value.enum.length);
			}

			if (idx === defaultValueIdx) {
				idx = (idx + 1) % value.enum.length;
			}

			nonDefaultOptions[key] = value.enum[idx];
		}
	});

	// Default values
	const defaultOptions = Object.entries(options).reduce((acc, [key, value]) => {
		if (value.default === undefined) {
			return acc;
		}
		acc[`${key}__DEFAULT`] = value.default;
		return acc;
	}, {} as { [key: string]: string | boolean });

	const config: DevContainerConfig = {
		image: args.baseImage,
		remoteUser: args.remoteUser,
		features: {
			[feature]: nonDefaultOptions, // Set of non-default option values (when possible)
		}
	};

	// Create Container
	const workspaceFolder = await generateProjectFromScenario(
		cliHost,
		collectionFolder,
		scenarioName,
		config,
		undefined,
		[{ featureId: feature, featureValue: {} }] // Default option values
	);
	const params = await generateDockerParams(workspaceFolder, args);
	await createContainerFromWorkingDirectory(params, workspaceFolder, args);

	// Move the entire test directory for the given Feature into the workspaceFolder
	await cpDirectoryLocal(featureTestFolder, workspaceFolder);

	// // Move the test library script into the workspaceFolder
	await cliHost.writeFile(path.join(workspaceFolder, TEST_LIBRARY_SCRIPT_NAME), Buffer.from(testLibraryScript));

	// Execute Test
	testResults.push({
		testName: scenarioName,
		result: await execTest(testFileName, workspaceFolder, cliHost, { ...nonDefaultOptions, ...defaultOptions })
	});
	return testResults;
}

async function readFeatureMetadata(args: FeaturesTestCommandInput, feature: string): Promise<Feature> {
	const { cliHost, collectionFolder } = args;
	const featureSrcFolder = path.join(collectionFolder, 'src', feature);

	const metadataFile = path.join(featureSrcFolder, 'devcontainer-feature.json');
	if (!await (cliHost.isFile(metadataFile))) {
		fail(`Feature '${feature}' does not contain a 'devcontainer-feature.json' file.`);
	}
	const buf = await cliHost.readFile(metadataFile);
	if (!buf || buf.length === 0) {
		fail(`Failed to read 'devcontainer-feature.json' file for feature '${feature}'`);
	}

	return jsonc.parse(buf.toString()) as Feature;
}

async function runFeatureTests(args: FeaturesTestCommandInput, testResults: TestResult[] = []): Promise<TestResult[]> {
	const { baseImage, collectionFolder, remoteUser, cliHost, skipAutogenerated, skipScenarios, skipDuplicateTest } = args;
	let { features } = args;

	const testsDir = `${collectionFolder}/test`;

	log(`baseImage:         ${baseImage}`);
	log(`Target Folder:     ${collectionFolder}`);

	// Parse comma separated list of features
	// If a set of '--features' isn't specified, run all features with a 'test' subfolder in random order.
	if (!features) {
		// Auto-detect
		features =
			(await cliHost.readDir(testsDir))
				.filter(f => f !== '_global'); // Exclude any folder named '_global'

		if (features.length === 0) {
			fail(`No features specified and no test folders found in '${testsDir}'`);
		}
	}

	log(`features:          ${features.join(', ')}`);

	let workspaceFolder: string | undefined = undefined;
	let params: DockerResolverParameters | undefined = undefined;
	if (!skipAutogenerated) {
		// Generate temporary project with 'baseImage' and all the 'features..'
		workspaceFolder = await generateDefaultProjectFromFeatures(
			cliHost,
			baseImage,
			collectionFolder,
			features,
			remoteUser
		);

		params = await generateDockerParams(workspaceFolder, args);
		await createContainerFromWorkingDirectory(params, workspaceFolder, args);
	}

	log('Starting test(s)...\n', { prefix: '\n🏃', info: true });

	// Exec default 'test.sh' script for each feature, in the provided order.
	// Also exec a test's test scenarios, if a scenarios.json is present in the feature's test folder.
	for (const feature of features) {
		log(`Starting '${feature}' tests...`, { prefix: '🧪' });
		const featureTestFolder = path.join(collectionFolder, 'test', feature);

		if (!skipAutogenerated) {
			if (!workspaceFolder || !params) {
				fail('Uninitialized workspaceFolder or params');
				return [];
			}
			await doRunAutoTest(feature, workspaceFolder, featureTestFolder, args, testResults);
		}

		// If there is a feature-scoped 'scenarios.json' with additional tests, also exec those.
		// Pass  'testResults' array reference in to capture results.
		if (!skipScenarios) {
			log(`Executing scenarios for feature '${feature}'...`, { prefix: '🧪' });
			await doScenario(featureTestFolder, feature, args, testResults);
		}

		if (!skipDuplicateTest) {
			log(`Executing duplicate test for feature '${feature}'...`, { prefix: '🧪' });
			await runDuplicateTest(args, feature, testResults);
		}

		if (!testResults) {
			fail(`Failed to run tests`);
			return []; // We never reach here, we exit via fail().
		}
	}
	return testResults;
}

async function doRunAutoTest(feature: string, workspaceFolder: string, featureTestFolder: string, args: FeaturesTestCommandInput, testResults: TestResult[] = []): Promise<TestResult[]> {
	const { cliHost } = args;
	const testScriptPath = path.join(featureTestFolder, 'test.sh');
	if (!(await cliHost.isFile(testScriptPath))) {
		fail(`Could not find test.sh script at ${testScriptPath}`);
	}

	// Move the entire test directory for the given Feature into the workspaceFolder
	await cpDirectoryLocal(featureTestFolder, workspaceFolder);

	// Move the test library script into the workspaceFolder test scripts folder.
	await cliHost.writeFile(path.join(workspaceFolder, TEST_LIBRARY_SCRIPT_NAME), Buffer.from(testLibraryScript));

	// Execute Test
	const result = await execTest('test.sh', workspaceFolder, cliHost);
	testResults.push({
		testName: feature,
		result,
	});

	return testResults;
}

async function doScenario(pathToTestDir: string, targetFeatureOrGlobal: string, args: FeaturesTestCommandInput, testResults: TestResult[] = []): Promise<TestResult[]> {
	const { collectionFolder, cliHost, filter } = args;
	const scenariosPath = path.join(pathToTestDir, 'scenarios.json');

	if (!(await cliHost.isFile(scenariosPath))) {
		log(`No scenario file found at '${scenariosPath}'. Skipping...`, { prefix: '⚠️', });
		return testResults;
	}

	// Read in scenarios.json
	const scenariosBuffer = await cliHost.readFile(scenariosPath);
	// Parse to json
	let scenarios: Scenarios = {};
	let errors: jsonc.ParseError[] = [];
	scenarios = jsonc.parse(scenariosBuffer.toString(), errors);
	if (errors.length > 0) {
		// Print each jsonc error
		errors.forEach(error => {
			log(`${jsonc.printParseErrorCode(error.error)}`, { prefix: '⚠️' });
		});
		fail(`Failed to parse scenarios.json at ${scenariosPath}`);
		return []; // We never reach here, we exit via fail()
	}

	// For EACH scenario: Spin up a container and exec the scenario test script
	for (const [scenarioName, scenarioConfig] of Object.entries(scenarios)) {

		if (filter && !scenarioName.includes(filter)) {
			continue;
		}

		log(`Running scenario:  ${scenarioName}`);

		// Check if we have a scenario test script, otherwise skip.
		if (!(await cliHost.isFile(path.join(pathToTestDir, `${scenarioName}.sh`)))) {
			fail(`No scenario test script found at path '${path.join(pathToTestDir, `${scenarioName}.sh`)}'.  Either add a script to the test folder, or remove from scenarios.json.`);
		}

		// Create Container
		const workspaceFolder = await generateProjectFromScenario(cliHost, collectionFolder, scenarioName, scenarioConfig, targetFeatureOrGlobal);
		const params = await generateDockerParams(workspaceFolder, args);
		await createContainerFromWorkingDirectory(params, workspaceFolder, args);

		// Move the entire test directory for the given Feature into the workspaceFolder
		await cpDirectoryLocal(pathToTestDir, workspaceFolder);

		// Move the test library script into the workspaceFolder
		await cliHost.writeFile(path.join(workspaceFolder, TEST_LIBRARY_SCRIPT_NAME), Buffer.from(testLibraryScript));

		// Execute Test
		testResults.push({
			testName: scenarioName,
			result: await execTest(`${scenarioName}.sh`, workspaceFolder, cliHost)
		});
	}
	return testResults;
}

function analyzeTestResults(testResults: { testName: string; result: boolean }[]): number {
	if (!testResults) {
		fail('No test results found!');
	}
	// 4. Print results
	// NOTE: 0 tests means allPassed == true.
	const allPassed = testResults.every((x) => x.result);
	process.stdout.write('\n\n\n');
	log('================== TEST REPORT ==================', { 'info': true, 'prefix': ' ' });
	testResults.forEach(t => {
		if (t.result) {
			log(`Passed:      '${t.testName}'`, { 'prefix': '✅', 'info': true });
		} else {
			log(`Failed:      '${t.testName}'`, { 'prefix': '❌', 'info': true });
		}
	});
	process.stdout.write('\n');
	return allPassed ? 0 : 1;
}

const devcontainerTemplate = `
{
	#{REMOTE_USER}
	"image": "#{IMAGE}",
	"features": {
		#{FEATURES}
	}
}`;

async function createContainerFromWorkingDirectory(params: DockerResolverParameters, workspaceFolder: string, args: FeaturesTestCommandInput): Promise<LaunchResult | undefined> {
	const { quiet, disposables } = args;
	log(`workspaceFolder:   ${workspaceFolder}`);

	// 2. Use  'devcontainer-cli up'  to build and start a container
	log('Building test container...\n', { prefix: '\n⏳', info: true });
	const launchResult: LaunchResult | undefined = await launchProject(params, workspaceFolder, quiet, disposables);
	if (!launchResult || !launchResult.containerId) {
		fail('Failed to launch container');
		return;
	}

	const { containerId } = launchResult;

	log(`Launched container.`, { prefix: '\n🚀', info: true });
	log(`containerId:          ${containerId}`);

	return launchResult;
}

async function createTempDevcontainerFolder(cliHost: CLIHost): Promise<string> {
	const systemTmpDir = tmpdir();
	const tmpFolder = path.join(systemTmpDir, 'devcontainercli', 'container-features-test', Date.now().toString());
	await cliHost.mkdirp(`${tmpFolder}/.devcontainer`);
	return tmpFolder;
}

async function generateDefaultProjectFromFeatures(
	cliHost: CLIHost,
	baseImage: string,
	collectionsDirectory: string,
	featuresToTest: string[],
	remoteUser: string | undefined
): Promise<string> {
	const tmpFolder = await createTempDevcontainerFolder(cliHost);

	const features = featuresToTest
		.map((x) => `"./${x}": {}`)
		.join(',\n');

	for (const featureId of featuresToTest) {
		// Copy the feature source code to the temp folder
		const pathToFeatureSource = `${collectionsDirectory}/src/${featureId}`;

		if (! await cliHost.isFolder(pathToFeatureSource)) {
			await rmLocal(tmpFolder, { recursive: true, force: true });
			fail(`Folder '${pathToFeatureSource}' does not exist for the '${featureId}' Feature.`);
		}

		await cpDirectoryLocal(pathToFeatureSource, `${tmpFolder}/.devcontainer/${featureId}`);
	}

	let template = devcontainerTemplate
		.replace('#{IMAGE}', baseImage)
		.replace('#{FEATURES}', features);

	if (remoteUser) {
		template = template.replace('#{REMOTE_USER}', `"remoteUser": "${remoteUser}",`);
	} else {
		template = template.replace('#{REMOTE_USER}', '');
	}

	await cliHost.writeFile(`${tmpFolder}/.devcontainer/devcontainer.json`, Buffer.from(template));

	return tmpFolder;
}

async function generateProjectFromScenario(
	cliHost: CLIHost,
	collectionsDirectory: string,
	scenarioId: string,
	scenarioObject: DevContainerConfig,
	targetFeatureOrGlobal: string | undefined,
	additionalFeatures: { featureId: string; featureValue: {} }[] = []
): Promise<string> {
	const tmpFolder = await createTempDevcontainerFolder(cliHost);

	let features = scenarioObject.features;
	if (!scenarioObject || !features) {
		fail(`Scenario '${scenarioId}' is missing Features!`);
		return ''; // Exits in the 'fail()' before this line is reached.
	}

	// Prefix the local path to the collections directory
	let updatedFeatures: Record<string, string | boolean | Record<string, string | boolean>> = {};
	for (const [featureId, featureValue] of Object.entries(features)) {
		// Do not overwrite Features that are not part of the target collection
		// The '/' is only valid in a fully qualified Feature ID (eg: '[ghcr].io/devcontainers/features/go')
		// This lets you use external Features as a part of the test scenario.
		if (featureId.indexOf('/') !== -1) {
			updatedFeatures[featureId] = featureValue;
			continue;
		}

		// Copy the feature source code to the temp folder
		const pathToFeatureSource = `${collectionsDirectory}/src/${featureId}`;
		await cpDirectoryLocal(pathToFeatureSource, `${tmpFolder}/.devcontainer/${featureId}`);

		// Reference Feature in the devcontainer.json
		updatedFeatures[`./${featureId}`] = featureValue;
	}

	let counter = 0;
	for (const { featureId, featureValue } of additionalFeatures) {
		const pathToFeatureSource = `${collectionsDirectory}/src/${featureId}`;

		const orderedFeatureId = `${featureId}-${counter++}`;
		const destPath = `${tmpFolder}/.devcontainer/${orderedFeatureId}`;
		await cpDirectoryLocal(pathToFeatureSource, destPath);

		// Reference Feature in the devcontainer.json
		updatedFeatures[`./${orderedFeatureId}`] = featureValue;
	}

	scenarioObject.features = updatedFeatures;

	log(`Scenario generated: ${JSON.stringify(scenarioObject, null, 2)}`, { prefix: '\n📝', info: true });

	await cliHost.writeFile(`${tmpFolder}/.devcontainer/devcontainer.json`, Buffer.from(JSON.stringify(scenarioObject)));

	// If the current scenario has a corresponding additional config folder, copy it into the $TMP/.devcontainer directory
	// This lets the scenario use things like Dockerfiles, shell scripts, etc. in the build.
	if (targetFeatureOrGlobal) {
		const localPathToAdditionalConfigFolder = `${collectionsDirectory}/test/${targetFeatureOrGlobal}/${scenarioId}`;
		if (await cliHost.isFolder(localPathToAdditionalConfigFolder)) {
			await cpDirectoryLocal(localPathToAdditionalConfigFolder, `${tmpFolder}/.devcontainer`);
		}
	}

	// Update permissions on the copied files to make them readable/writable/executable by everyone
	await cliHost.exec({ cmd: 'chmod', args: ['-R', '777', tmpFolder], output: nullLog });

	// tmpFolder will serve as our auto-generated 'workingFolder'
	return tmpFolder;
}

async function launchProject(params: DockerResolverParameters, workspaceFolder: string, quiet: boolean, disposables: (() => Promise<unknown> | undefined)[]): Promise<LaunchResult> {
	const { common } = params;
	let response = {} as LaunchResult;

	const idLabels = [`devcontainer.local_folder=${workspaceFolder}`, `devcontainer.is_test_run=true`];
	const options: ProvisionOptions = {
		...staticProvisionParams,
		workspaceFolder,
		additionalLabels: [],
		logLevel: common.getLogLevel(),
		mountWorkspaceGitRoot: true,
		remoteEnv: common.remoteEnv,
		skipFeatureAutoMapping: common.skipFeatureAutoMapping,
		skipPersistingCustomizationsFromFeatures: common.skipPersistingCustomizationsFromFeatures,
		omitConfigRemotEnvFromMetadata: common.omitConfigRemotEnvFromMetadata,
		log: text => quiet ? null : process.stderr.write(text),
		dotfiles: {}
	};

	try {
		if (quiet) {
			// Launch container but don't await it to reduce output noise
			let isResolved = false;
			const p = launch(options, idLabels, disposables);
			p.then(function (res) {
				process.stdout.write('\n');
				response = res;
				isResolved = true;
			});
			while (!isResolved) {
				// Just so visual progress with dots
				process.stdout.write('.');
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		} else {
			// Stream all the container setup logs.
			response = await launch(options, idLabels, disposables);
		}

		return {
			...response,
			disposables,
		};
	} catch (e: any) {
		fail(`Failed to launch container:\n\n${e?.message ?? 'Unknown error'}`);
		return response; // `fail` exits before we return this.
	}
}

async function execTest(testFileName: string, workspaceFolder: string, cliHost: CLIHost, injectedEnv: { [varName: string]: string | boolean } = {}) {
	// Ensure all the tests scripts in the workspace folder are executable
	// Update permissions on the copied files to make them readable/writable/executable by everyone
	await cliHost.exec({ cmd: 'chmod', args: ['-R', '777', workspaceFolder], output: nullLog });

	const cmd = `./${testFileName}`;
	const args: string[] = [];
	return await exec(cmd, args, workspaceFolder, injectedEnv);
}

async function exec(cmd: string, args: string[], workspaceFolder: string, injectedEnv: { [name: string]: string | boolean } = {}) {
	const injectedEnvArray = Object.keys(injectedEnv).length > 0
		? Object.entries(injectedEnv).map(([key, value]) => `${getSafeId(key)}=${value}`)
		: undefined;

	const execArgs = {
		...staticExecParams,
		'remote-env': injectedEnvArray as any,
		'workspace-folder': workspaceFolder,
		'skip-feature-auto-mapping': false,
		cmd,
		args,
		_: [
			cmd,
			...args
		]
	};
	const result = await doExec(execArgs);
	return (!result.code && !result.signal);
}

async function generateDockerParams(workspaceFolder: string, args: FeaturesTestCommandInput): Promise<DockerResolverParameters> {
	const { logLevel, quiet, disposables } = args;
	return await createDockerParams({
		workspaceFolder,
		additionalLabels: [],
		dockerPath: undefined,
		dockerComposePath: undefined,
		containerDataFolder: undefined,
		containerSystemDataFolder: undefined,
		mountWorkspaceGitRoot: false,
		configFile: undefined,
		overrideConfigFile: undefined,
		logLevel,
		logFormat: 'text',
		log: text => quiet ? null : process.stderr.write(text),
		terminalDimensions: undefined,
		defaultUserEnvProbe: 'loginInteractiveShell',
		removeExistingContainer: false,
		buildNoCache: false,
		expectExistingContainer: false,
		postCreateEnabled: false,
		skipNonBlocking: false,
		prebuild: false,
		persistedFolder: undefined,
		additionalMounts: [],
		updateRemoteUserUIDDefault: 'never',
		remoteEnv: {},
		additionalCacheFroms: [],
		omitLoggerHeader: true,
		useBuildKit: 'auto',
		buildxPlatform: undefined,
		buildxPush: false,
		buildxOutput: undefined,
		buildxCacheTo: undefined,
		skipFeatureAutoMapping: false,
		skipPostAttach: false,
		skipPersistingCustomizationsFromFeatures: false,
		dotfiles: {}
	}, disposables);
}
