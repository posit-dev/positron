import { Argv } from 'yargs';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import * as jsonc from 'jsonc-parser';
import { UnpackArgv } from '../devContainersSpecCLI';
import { fetchTemplate, SelectedTemplate, TemplateFeatureOption, TemplateOptions } from '../../spec-configuration/containerTemplatesOCI';
import { runAsyncHandler } from '../utils';

export function templateApplyOptions(y: Argv) {
	return y
		.options({
			'workspace-folder': { type: 'string', alias: 'w', demandOption: true, default: '.', description: 'Target workspace folder to apply Template' },
			'template-id': { type: 'string', alias: 't', demandOption: true, description: 'Reference to a Template in a supported OCI registry' },
			'template-args': { type: 'string', alias: 'a', default: '{}', description: 'Arguments to replace within the provided Template, provided as JSON' },
			'features': { type: 'string', alias: 'f', default: '[]', description: 'Features to add to the provided Template, provided as JSON.' },
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'tmp-dir': { type: 'string', description: 'Directory to use for temporary files. If not provided, the system default will be inferred.' },
			'omit-paths': { type: 'string', default: '[]', description: 'List of paths within the Template to omit applying, provided as JSON.  To ignore a directory append \'/*\'. Eg: \'[".github/*", "dir/a/*", "file.ts"]\'' },
		})
		.check(_argv => {
			return true;
		});
}

export type TemplateApplyArgs = UnpackArgv<ReturnType<typeof templateApplyOptions>>;

export function templateApplyHandler(args: TemplateApplyArgs) {
	runAsyncHandler(templateApply.bind(null, args));
}

async function templateApply({
	'workspace-folder': workspaceFolder,
	'template-id': templateId,
	'template-args': templateArgs,
	'features': featuresArgs,
	'log-level': inputLogLevel,
	'tmp-dir': userProvidedTmpDir,
	'omit-paths': omitPathsArg,
}: TemplateApplyArgs) {
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

	const id = templateId;

	let templateArgsErrors: jsonc.ParseError[] = [];
	const options = jsonc.parse(templateArgs, templateArgsErrors);

	if (!options || !validateTemplateOptions(output, options, templateArgsErrors)) {
		output.write('Invalid template arguments provided.', LogLevel.Error);
		process.exit(1);
	}
	const features = jsonc.parse(featuresArgs);
	let featuresArgsErrors: jsonc.ParseError[] = [];
	if (!features || !validateTemplateFeatureOption(output, features, featuresArgsErrors)) {
		output.write('Invalid template arguments provided.', LogLevel.Error);
		process.exit(1);
	}

	let omitPaths: string[] = [];
	if (omitPathsArg) {
		let omitPathsErrors: jsonc.ParseError[] = [];
		omitPaths = jsonc.parse(omitPathsArg, omitPathsErrors);
		if (!Array.isArray(omitPaths)) {
			output.write('Invalid \'--omitPaths\' argument provided. Provide as a JSON array, eg: \'[".github/*", "dir/a/*", "file.ts"]\'', LogLevel.Error);
			process.exit(1);
		}
	}

	const selectedTemplate: SelectedTemplate = {
		id: templateId,
		options,
		features,
		omitPaths,
	};

	const files = await fetchTemplate({ output, env: process.env }, selectedTemplate, workspaceFolder, userProvidedTmpDir);
	if (!files) {
		output.write(`Failed to fetch template '${id}'.`, LogLevel.Error);
		process.exit(1);
	}

	console.log(JSON.stringify({ files }));
	await dispose();
	process.exit();
}

// '{ "installZsh": "false", "upgradePackages": "true", "dockerVersion": "20.10", "moby": "true", "enableNonRootDocker": "true" }'
function validateTemplateOptions(output: Log, target: unknown, errors: jsonc.ParseError[]): target is TemplateOptions {
	if (hasJsonParseError(output, errors)) {
		return false;
	}

	if (Array.isArray(target) || typeof target !== 'object' || target === null) {
		output.write(`Invalid template options provided. Expected an object.`, LogLevel.Error);
		return false;
	}

	for (const [_, [key, value]] of Object.entries(target).entries()) {
		if (typeof key !== 'string') {
			output.write(`Invalid template options provided. Expected a string key, but got ${typeof key}`, LogLevel.Error);
			return false;
		}

		if (typeof value !== 'string') {
			output.write(`Invalid template options provided. Expected a string value, but got ${typeof value}`, LogLevel.Error);
			return false;
		}
	}

	return true;
}

// '[{ "id": "ghcr.io/devcontainers/features/azure-cli:1", "options": { "version" : "1" } }]'
function validateTemplateFeatureOption(output: Log, target: unknown, errors: jsonc.ParseError[]): target is TemplateFeatureOption[] {
	if (hasJsonParseError(output, errors)) {
		return false;
	}

	if (!Array.isArray(target)) {
		output.write(`Invalid template options provided. Expected an array.`, LogLevel.Error);
		return false;
	}

	for (const [_, value] of Object.entries(target)) {
		const feature = value as TemplateFeatureOption;
		if (!feature?.id) {
			output.write(`Feature entry requires an Id.`, LogLevel.Error);
			return false;
		}
	}

	return true;
}

function hasJsonParseError(output: Log, errors: jsonc.ParseError[]) {
	for (const error of errors) {
		output.write(`JSON parse error: ${jsonc.printParseErrorCode(error.error)}`, LogLevel.Error);
	}
	return errors.length > 0;
}

