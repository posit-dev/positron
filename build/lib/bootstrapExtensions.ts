/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as rimraf from 'rimraf';
import * as es from 'event-stream';
import * as vfs from 'vinyl-fs';
import * as ext from './extensions';
import * as ansiColors from 'ansi-colors';
import rename from 'gulp-rename';
import fancyLog from 'fancy-log';
import { Stream } from 'stream';
import { IExtensionDefinition } from './builtInExtensions';

const root = path.dirname(path.dirname(__dirname));
const productjson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8'));
const ENABLE_LOGGING = !process.env['VSCODE_BUILD_BOOTSTRAP_EXTENSIONS_SILENCE_PLEASE'];

const bootstrapExtensions = <IExtensionDefinition[]>productjson.bootstrapExtensions || [];
const controlFilePath = path.join(os.homedir(), '.vscode-oss-dev', 'extensions', 'bootstrap-control.json');

function log(...messages: string[]): void {
	if (ENABLE_LOGGING) {
		fancyLog(...messages);
	}
}

function getBootstrapDir(): string {
	return path.join(root, '.build', 'bootstrapExtensions');
}

function getExtensionName(extension: IExtensionDefinition): string {
	return `${extension.name}-${extension.version}.vsix`;
}

function isUpToDate(extension: IExtensionDefinition): boolean {
	const regex = new RegExp(`^${extension.name}-(\\d+\\.\\d+\\.\\d+)\\.vsix$`);
	const bootstrapDir = getBootstrapDir();
	if (!fs.existsSync(bootstrapDir)) {
		return false;
	}

	// Production builds for macOS are universal and require packaging for both arm64 and x64.
	// For these builds, multi-arch extensions are stored in separate directories ./arm64 and ./x64.
	// We need to make sure both directories are up to date, and otherwise return false.
	// For non production and non-macOS builds, we only package one extension and therefore only need
	// to check the main directory

	const isMultiArch = !process.env['VSCODE_DEV'] && process.platform === 'darwin' && extension.metadata?.multiPlatformServiceUrl;

	if (isMultiArch) {
		// First, remove all versions of the extension from the main directory
		const files = fs.readdirSync(bootstrapDir);
		const matchingFiles = files.filter(f => regex.test(f));

		for (const vsixPath of matchingFiles) {
			log(`[extensions]`, `Outdated version detected, deleting ${vsixPath}`);
			fs.unlinkSync(path.join(bootstrapDir, vsixPath));
		}

		// Now check the architecture directories
		const archDirs = ['arm64', 'x64'];
		for (const arch of archDirs) {
			const archDir = path.join(bootstrapDir, arch);

			if (!fs.existsSync(archDir)) {
				log(`[extensions]`, `Architecture folder ${archDir} does not exist`);
				return false;
			}

			const archFiles = fs.readdirSync(archDir);
			const matchingArchFiles = archFiles.filter(f => regex.test(f));

			if (matchingArchFiles.length === 0) {
				log(`[extensions]`, `No matching extensions in ${arch} directory`);
				return false;
			}

			let archUpToDate = false;

			for (const vsixPath of matchingArchFiles) {
				try {
					const match = vsixPath.match(regex);
					const diskVersion = match ? match[1] : null;

					if (diskVersion !== extension.version) {
						log(`[extensions]`, `Outdated version detected in ${arch}, deleting ${vsixPath}`);
						fs.unlinkSync(path.join(archDir, vsixPath));
					} else {
						log(`[extensions]`, `Found up-to-date extension in ${arch}: ${vsixPath}`);
						archUpToDate = true;
					}
				} catch (err) {
					log(`[extensions]`, `Error checking version of ${vsixPath} in ${arch}`, err);
					return false;
				}
			}

			if (!archUpToDate) {
				return false;
			}
		}

		return true;
	} else {
		// First, remove from any architecture directories
		const archDirs = ['arm64', 'x64'];
		for (const arch of archDirs) {
			const archDir = path.join(bootstrapDir, arch);
			if (fs.existsSync(archDir)) {
				const archFiles = fs.readdirSync(archDir);
				const matchingArchFiles = archFiles.filter(f => regex.test(f));

				for (const vsixPath of matchingArchFiles) {
					log(`[extensions]`, `Outdated version detected, deleting ${vsixPath}`);
					fs.unlinkSync(path.join(archDir, vsixPath));
				}
			}
		}

		// Now check the main directory
		const files = fs.readdirSync(bootstrapDir);
		const matchingFiles = files.filter(f => regex.test(f));

		for (const vsixPath of matchingFiles) {
			try {
				const match = vsixPath.match(regex);
				const diskVersion = match ? match[1] : null;

				if (diskVersion !== extension.version) {
					log(`[extensions]`, `Outdated version detected, deleting ${vsixPath}`);
					fs.unlinkSync(path.join(bootstrapDir, vsixPath));
				} else {
					return true;
				}
			} catch (err) {
				log(`[extensions]`, `Error checking version of ${vsixPath}`, err);
				return false;
			}
		}
		return false;
	}
}

function getExtensionDownloadStream(extension: IExtensionDefinition) {
	const url = extension.metadata.multiPlatformServiceUrl || productjson.extensionsGallery?.serviceUrl;
	const stream = url ? ext.fromMarketplace(url, extension, true) : ext.fromGithub(extension);
	return stream.pipe(rename(p => {
		if (p.basename === 'x64' || p.basename === 'arm64') {
			p.dirname = path.join(p.dirname || '', p.basename);
		}
		p.basename = `${extension.name}-${extension.version}.vsix`;
	}));
}

export function getBootstrapExtensionStream(extension: IExtensionDefinition) {
	// if the extension exists on disk, use those files instead of downloading anew
	if (isUpToDate(extension)) {
		log('[extensions]', `${extension.name}@${extension.version} up to date`, ansiColors.green('✔︎'));
		return es.merge(vfs.src([`**/${getExtensionName(extension)}`], { cwd: path.join(getBootstrapDir()), dot: true }));
	}
	return getExtensionDownloadStream(extension);
}

function syncMarketplaceExtension(extension: IExtensionDefinition): Stream {
	const galleryServiceUrl = productjson.extensionsGallery?.serviceUrl;
	const source = ansiColors.blue(galleryServiceUrl ? '[marketplace]' : '[github]');
	if (isUpToDate(extension)) {
		log(source, `${extension.name}@${extension.version}`, ansiColors.green('✔︎'));
		return es.readArray([]);
	}

	return getExtensionDownloadStream(extension)
		.pipe(vfs.dest('.build/bootstrapExtensions'))
		.on('end', () => log(source, extension.name, ansiColors.green('✔︎')));
}

function syncExtension(extension: IExtensionDefinition, controlState: 'disabled' | 'marketplace'): Stream {
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
			return syncMarketplaceExtension(extension);

		default:
			if (!fs.existsSync(controlState)) {
				log(ansiColors.red(`Error: Bootstrap extension '${extension.name}' is configured to run from '${controlState}' but that path does not exist.`));
				return es.readArray([]);

			} else if (!fs.existsSync(path.join(controlState, 'package.json'))) {
				log(ansiColors.red(`Error: Bootstrap extension '${extension.name}' is configured to run from '${controlState}' but there is no 'package.json' file in that directory.`));
				return es.readArray([]);
			}

			log(ansiColors.blue('[local]'), `${extension.name}: ${ansiColors.cyan(controlState)}`, ansiColors.green('✔︎'));
			return es.readArray([]);
	}
}

interface IControlFile {
	[name: string]: 'disabled' | 'marketplace';
}

function readControlFile(): IControlFile {
	try {
		return JSON.parse(fs.readFileSync(controlFilePath, 'utf8'));
	} catch (err) {
		return {};
	}
}

function writeControlFile(control: IControlFile): void {
	fs.mkdirSync(path.dirname(controlFilePath), { recursive: true });
	fs.writeFileSync(controlFilePath, JSON.stringify(control, null, 2));
}

export function getBootstrapExtensions(): Promise<void> {

	// Clean up and remove any architecture folders if they exist and aren't necessary
	if (process.env['VSCODE_DEV'] || process.platform !== 'darwin') {
		const archDirs = ['arm64', 'x64'];
		for (const arch of archDirs) {
			const archDir = path.join(getBootstrapDir(), arch);
			if (fs.existsSync(archDir)) {
				log(`[extensions]`, `Removing architecture folder ${archDir}`);
				rimraf.sync(archDir);
			}
		}
	}

	const control = readControlFile();
	const streams: Stream[] = [];

	for (const extension of [...bootstrapExtensions]) {
		const controlState = control[extension.name] || 'marketplace';
		control[extension.name] = controlState;

		streams.push(syncExtension(extension, controlState));
	}

	writeControlFile(control);

	return new Promise((resolve, reject) => {
		es.merge(streams)
			.on('error', reject)
			.on('end', resolve);
	});
}

if (require.main === module) {
	getBootstrapExtensions().then(() => process.exit(0)).catch(err => {
		console.error(err);
		process.exit(1);
	});
}
