/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as rimraf from 'rimraf';
import * as es from 'event-stream';
import * as rename from 'gulp-rename';
import * as vfs from 'vinyl-fs';
import * as ext from './extensions';
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';
import { Stream } from 'stream';

export interface IExtensionDefinition {
	name: string;
	version: string;
	sha256: string;
	repo: string;
	platforms?: string[];
	// --- Start PWB: Bundle PWB extension ---
	positUrl?: string;
	// --- End PWB: Bundle PWB extension ---
	metadata: {
		id: string;
		publisherId: {
			publisherId: string;
			publisherName: string;
			displayName: string;
			flags: string;
		};
		publisherDisplayName: string;
		// --- Start Positron ---
		multiPlatformServiceUrl?: string;
		// --- End Positron ---
	};
}

const root = path.dirname(path.dirname(__dirname));
const productjson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8'));
const builtInExtensions = <IExtensionDefinition[]>productjson.builtInExtensions || [];
const webBuiltInExtensions = <IExtensionDefinition[]>productjson.webBuiltInExtensions || [];
const controlFilePath = path.join(os.homedir(), '.vscode-oss-dev', 'extensions', 'control.json');
const ENABLE_LOGGING = !process.env['VSCODE_BUILD_BUILTIN_EXTENSIONS_SILENCE_PLEASE'];

// --- Start Positron ---
const bootstrapExtensions = <IExtensionDefinition[]>productjson.bootstrapExtensions || [];
const bootstrapControlFilePath = path.join(os.homedir(), '.vscode-oss-dev', 'extensions', 'bootstrap-control.json');
// --- End Positron ---

function log(...messages: string[]): void {
	if (ENABLE_LOGGING) {
		fancyLog(...messages);
	}
}

// --- Start Positron ---
function getExtensionPath(extension: IExtensionDefinition, bootstrap: boolean = false): string {
	return path.join(root, '.build', bootstrap ? 'bootstrapExtensions' : 'builtInExtensions', extension.name);
	// --- End Positron ---
}

// --- Start Positron ---
function isUpToDate(extension: IExtensionDefinition, bootstrap: boolean = false): boolean {
	const packagePath = path.join(getExtensionPath(extension, bootstrap), 'package.json');
	// --- End Positron ---

	if (!fs.existsSync(packagePath)) {
		return false;
	}

	const packageContents = fs.readFileSync(packagePath, { encoding: 'utf8' });

	try {
		const diskVersion = JSON.parse(packageContents).version;
		return (diskVersion === extension.version);
	} catch (err) {
		return false;
	}
}

// --- Start Positron ---
function getExtensionDownloadStream(extension: IExtensionDefinition, bootstrap: boolean = false) {
	// --- End Positron ---
	// --- Start PWB: Bundle PWB extension ---
	// the PWB extension is a special case because it's not availble from the marketplace or github
	if (extension.name === 'rstudio.rstudio-workbench') {
		return ext.fromPositUrl(extension)
			.pipe(rename(p => p.dirname = `${extension.name}/${p.dirname}`));
	}
	// --- End PWB: Bundle PWB extension ---
	// --- Start Positron ---
	const url = extension.metadata.multiPlatformServiceUrl || productjson.extensionsGallery?.serviceUrl;
	return (url ? ext.fromMarketplace(url, extension, bootstrap) : ext.fromGithub(extension))
		.pipe(rename(p => {
			if (bootstrap) {
				p.basename = `${extension.name}-${extension.version}.vsix`;
			} else {
				p.dirname = `${extension.name}/${p.dirname}`;
			}
		}));
	// --- End Positron ---
}

// --- Start Positron ---
export function getExtensionStream(extension: IExtensionDefinition, bootstrap: boolean = false) {
	// if the extension exists on disk, use those files instead of downloading anew
	if (isUpToDate(extension, bootstrap)) {
		// --- End Positron ---
		log('[extensions]', `${extension.name}@${extension.version} up to date`, ansiColors.green('✔︎'));
		return vfs.src(['**'], { cwd: getExtensionPath(extension), dot: true })
			.pipe(rename(p => p.dirname = `${extension.name}/${p.dirname}`));
	}

	// --- Start Positron ---
	return getExtensionDownloadStream(extension, bootstrap);
	// --- End Positron ---
}

// --- Start Positron ---
function syncMarketplaceExtension(extension: IExtensionDefinition, bootstrap: boolean = false): Stream {
	const galleryServiceUrl = productjson.extensionsGallery?.serviceUrl;
	const source = ansiColors.blue(galleryServiceUrl ? '[marketplace]' : '[github]');
	if (isUpToDate(extension, bootstrap)) {
		// --- End Positron ---
		log(source, `${extension.name}@${extension.version}`, ansiColors.green('✔︎'));
		return es.readArray([]);
	}

	rimraf.sync(getExtensionPath(extension));

	// --- Start Positron ---
	return getExtensionDownloadStream(extension, bootstrap)
		.pipe(vfs.dest(bootstrap ? '.build/bootstrapExtensions' : '.build/builtInExtensions'))
		// --- End Positron ---
		.on('end', () => log(source, extension.name, ansiColors.green('✔︎')));
}

// --- Start Positron ---
function syncExtension(extension: IExtensionDefinition, controlState: 'disabled' | 'marketplace', bootstrap: boolean = false): Stream {
	const description: string = bootstrap ? 'Bootstrap' : 'Built-in';
	// --- End Positron ---
	if (extension.platforms) {
		const platforms = new Set(extension.platforms);

		if (!platforms.has(process.platform)) {
			log(ansiColors.gray('[skip]'), `${extension.name}@${extension.version}: Platform '${process.platform}' not supported: [${extension.platforms}]`, ansiColors.green('✔︎'));
			return es.readArray([]);
		}
	}

	switch (controlState) {
		case 'disabled':
			log(ansiColors.blue('[disabled]'), ansiColors.gray(extension.name));
			return es.readArray([]);

		case 'marketplace':
			// --- Start Positron ---
			return syncMarketplaceExtension(extension, bootstrap);
		// --- End Positron ---

		default:
			if (!fs.existsSync(controlState)) {
				// --- Start Positron ---
				log(ansiColors.red(`Error: ${description} extension '${extension.name}' is configured to run from '${controlState}' but that path does not exist.`));
				// --- End Positron ---
				return es.readArray([]);

			} else if (!fs.existsSync(path.join(controlState, 'package.json'))) {
				// --- Start Positron ---
				log(ansiColors.red(`Error: ${description} extension '${extension.name}' is configured to run from '${controlState}' but there is no 'package.json' file in that directory.`));
				// --- End Positron ---
				return es.readArray([]);
			}

			log(ansiColors.blue('[local]'), `${extension.name}: ${ansiColors.cyan(controlState)}`, ansiColors.green('✔︎'));
			return es.readArray([]);
	}
}

interface IControlFile {
	[name: string]: 'disabled' | 'marketplace';
}

// --- Start Positron ---
function readControlFile(filePath: string = controlFilePath): IControlFile {
	// --- End Positron ---
	try {
		// --- Start Positron ---
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
		// --- End Positron ---
	} catch (err) {
		return {};
	}
}

// --- Start Positron ---
function writeControlFile(control: IControlFile, filePath: string = controlFilePath): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(control, null, 2));
	// --- End Positron ---
}

export function getBuiltInExtensions(): Promise<void> {
	log('Synchronizing built-in extensions...');
	log(`You can manage built-in extensions with the ${ansiColors.cyan('--builtin')} flag`);

	const control = readControlFile();
	const streams: Stream[] = [];

	for (const extension of [...builtInExtensions, ...webBuiltInExtensions]) {
		const controlState = control[extension.name] || 'marketplace';
		control[extension.name] = controlState;

		// --- Start Positron ---
		// Discard extensions intended for the web. The 'type' field isn't a
		// formal part of the extension definition but a custom field we use to
		// filter out web-only extensions (i.e. Posit Workbench)
		// @ts-ignore
		if (extension.type === 'reh-web') {
			continue;
		}
		// --- End Positron ---

		streams.push(syncExtension(extension, controlState));
	}

	writeControlFile(control);

	return new Promise((resolve, reject) => {
		es.merge(streams)
			.on('error', reject)
			.on('end', resolve);
	});
}

// --- Start Positron ---

export function getBootstrapExtensions(): Promise<void> {

	const control = readControlFile(bootstrapControlFilePath);
	const streams: Stream[] = [];

	for (const extension of [...bootstrapExtensions]) {
		const controlState = control[extension.name] || 'marketplace';
		control[extension.name] = controlState;

		streams.push(syncExtension(extension, controlState, true));
	}

	writeControlFile(control, bootstrapControlFilePath);

	return new Promise((resolve, reject) => {
		es.merge(streams)
			.on('error', reject)
			.on('end', resolve);
	});
}

if (require.main === module) {
	Promise.all([getBuiltInExtensions(), getBootstrapExtensions()])
		.then(() => process.exit(0))
		.catch(err => {
			console.error(err);
			process.exit(1);
		});
}

// --- End Positron ---
