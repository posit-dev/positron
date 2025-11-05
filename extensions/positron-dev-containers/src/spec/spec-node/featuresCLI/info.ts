import { Argv } from 'yargs';
import { OCIManifest, OCIRef, fetchOCIManifestIfExists, getPublishedTags, getRef } from '../../spec-configuration/containerCollectionsOCI';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { buildDependencyGraph, generateMermaidDiagram } from '../../spec-configuration/containerFeaturesOrder';
import { DevContainerFeature } from '../../spec-configuration/configuration';
import { processFeatureIdentifier } from '../../spec-configuration/containerFeaturesConfiguration';
import { runAsyncHandler } from '../utils';

export function featuresInfoOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'output-format': { choices: ['text' as 'text', 'json' as 'json'], default: 'text', description: 'Output format.' },
		})
		.positional('mode', { choices: ['manifest' as 'manifest', 'tags' as 'tags', 'dependencies' as 'dependencies', 'verbose' as 'verbose'], description: 'Data to query. Select \'verbose\' to return everything.' })
		.positional('feature', { type: 'string', demandOption: true, description: 'Feature Identifier' });
}

export type FeaturesInfoArgs = UnpackArgv<ReturnType<typeof featuresInfoOptions>>;

export function featuresInfoHandler(args: FeaturesInfoArgs) {
	runAsyncHandler(featuresInfo.bind(null, args));
}

interface InfoJsonOutput {
	manifest?: OCIManifest;
	canonicalId?: string;
	publishedTags?: string[];
}

async function featuresInfo({
	'mode': mode,
	'feature': featureId,
	'log-level': inputLogLevel,
	'output-format': outputFormat,
}: FeaturesInfoArgs) {
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

	const params = { output, env: process.env, outputFormat };

	const jsonOutput: InfoJsonOutput = {};

	// Parse the provided Feature Id
	const featureRef = getRef(output, featureId);
	if (!featureRef) {
		if (outputFormat === 'json') {
			console.log(JSON.stringify({}), LogLevel.Info);
		} else {
			console.log(`Failed to parse Feature identifier '${featureId}'\n`, LogLevel.Error);
		}
		process.exit(1);
	}

	const manifestContainer = await getManifest(params, featureRef);
	if (!manifestContainer) {
		process.exit(1);
	}

	// -- Display the manifest
	if (mode === 'manifest' || mode === 'verbose') {
		const { manifestObj, canonicalId } = manifestContainer;
		if (outputFormat === 'text') {
			console.log(encloseStringInBox('Manifest'));
			console.log(`${JSON.stringify(manifestObj, undefined, 2)}\n`);
			console.log(encloseStringInBox('Canonical Identifier'));
			console.log(`${canonicalId}\n`);
		} else {
			jsonOutput.manifest = manifestObj;
			jsonOutput.canonicalId = canonicalId;
		}
	}

	// --- Get all published tags for resource
	if (mode === 'tags' || mode === 'verbose') {
		const publishedTags = await getTags(params, featureRef);
		if (outputFormat === 'text') {
			console.log(encloseStringInBox('Published Tags'));
			console.log(`${publishedTags.join('\n   ')}`);
		} else {
			jsonOutput.publishedTags = publishedTags;
		}
	}

	if ((mode === 'dependencies' || mode === 'verbose') && outputFormat === 'text') {
		output.write(`Building dependency graph for '${featureId}'...`, LogLevel.Info);
		if (!featureRef) {
			output.write(`Provide Feature reference '${featureId}' is invalid.`, LogLevel.Error);
			process.exit(1);
		}

		const processFeature = async (_userFeature: DevContainerFeature) => {
			return await processFeatureIdentifier(params, undefined, '', _userFeature);
		};
		const graph = await buildDependencyGraph(params, processFeature, [{ userFeatureId: featureId, options: {} }], { overrideFeatureInstallOrder: undefined }, undefined);
		output.write(JSON.stringify(graph, undefined, 4), LogLevel.Trace);
		if (!graph) {
			output.write(`Could not build dependency graph.`, LogLevel.Error);
			process.exit(1);
		}

		if (outputFormat === 'text') {
			console.log(encloseStringInBox('Dependency Tree (Render with https://mermaid.live/)'));
			const diagram = generateMermaidDiagram(params, graph.worklist);
			console.log(diagram);
		}
	}

	// -- Output and clean up
	if (outputFormat === 'json') {
		console.log(JSON.stringify(jsonOutput, undefined, 4));
	}
	await dispose();
	process.exit();
}


async function getManifest(params: { output: Log; env: NodeJS.ProcessEnv; outputFormat: string }, featureRef: OCIRef) {
	const { outputFormat } = params;

	const manifestContainer = await fetchOCIManifestIfExists(params, featureRef, undefined);
	if (!manifestContainer) {
		if (outputFormat === 'json') {
			console.log(JSON.stringify({}));
		} else {
			console.log('No manifest found! If this manifest requires authentication, please login.');
		}
		return process.exit(1);
	}
	return manifestContainer;
}

async function getTags(params: { output: Log; env: NodeJS.ProcessEnv; outputFormat: string }, featureRef: OCIRef) {
	const { outputFormat } = params;
	const publishedTags = await getPublishedTags(params, featureRef);
	if (!publishedTags || publishedTags.length === 0) {
		if (outputFormat === 'json') {
			console.log(JSON.stringify({}));
		} else {
			console.log(`No published versions found for feature '${featureRef.resource}'\n`);
		}
		process.exit(1);
	}
	return publishedTags;
}

function encloseStringInBox(str: string, indent: number = 0) {
	const lines = str.split('\n');
	lines[0] = `\u001b[1m${lines[0]}\u001b[22m`; // Bold
	const maxWidth = Math.max(...lines.map(l => l.length - (l.includes('\u001b[1m') ? 9 : 0)));
	const box = [
		'┌' + '─'.repeat(maxWidth) + '┐',
		...lines.map(l => '│' + l.padEnd(maxWidth + (lines.length > 1 && l.includes('\u001b[1m') ? 9 : 0)) + '│'),
		'└' + '─'.repeat(maxWidth) + '┘',
	];
	return box.map(t => `${' '.repeat(indent)}${t}`).join('\n');
}