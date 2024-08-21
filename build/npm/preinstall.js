/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
let err = false;

const nodeVersion = /^(\d+)\.(\d+)\.(\d+)/.exec(process.versions.node);
const majorNodeVersion = parseInt(nodeVersion[1]);
const minorNodeVersion = parseInt(nodeVersion[2]);
const patchNodeVersion = parseInt(nodeVersion[3]);

if (!process.env['VSCODE_SKIP_NODE_VERSION_CHECK']) {
	if (majorNodeVersion < 20) {
		console.error('\x1b[1;31m*** Please use latest Node.js v20 LTS for development.\x1b[0;0m');
		err = true;
	}
}

const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const gulp = require('gulp');
const mergeJson = require('gulp-merge-json');
const yarnVersion = cp.execSync('yarn -v', { encoding: 'utf8' }).trim();
const parsedYarnVersion = /^(\d+)\.(\d+)\.(\d+)/.exec(yarnVersion);
const majorYarnVersion = parseInt(parsedYarnVersion[1]);
const minorYarnVersion = parseInt(parsedYarnVersion[2]);
const patchYarnVersion = parseInt(parsedYarnVersion[3]);

if (
	majorYarnVersion < 1 ||
	majorYarnVersion === 1 && (
		minorYarnVersion < 10 || (minorYarnVersion === 10 && patchYarnVersion < 1)
	) ||
	majorYarnVersion >= 2
) {
	console.error('\x1b[1;31m*** Please use yarn >=1.10.1 and <2.\x1b[0;0m');
	err = true;
}

if (!/yarn[\w-.]*\.c?js$|yarnpkg$/.test(process.env['npm_execpath'])) {
	console.error('\x1b[1;31m*** Please use yarn to install dependencies.\x1b[0;0m');
	err = true;
}

if (process.platform === 'win32') {
	if (!hasSupportedVisualStudioVersion()) {
		console.error('\x1b[1;31m*** Invalid C/C++ Compiler Toolchain. Please check https://github.com/microsoft/vscode/wiki/How-to-Contribute#prerequisites.\x1b[0;0m');
		err = true;
	}
	if (!err) {
		installHeaders();
	}
}

// --- Start Positron ---
// This ensures that the `remote/reh-web` package.json file is created/updated before `yarn` is run,
// so the yarn.lock and node_modules are created/updated with the appropriate dependencies.
// This will create a side effect of needing to commit the changes to the `remote/reh-web`
// package.json and yarn.lock files if they are updated.
generateRehWebPackageJson();
// --- End Positron ---

if (err) {
	console.error('');
	process.exit(1);
}

function hasSupportedVisualStudioVersion() {
	const fs = require('fs');
	const path = require('path');
	// Translated over from
	// https://source.chromium.org/chromium/chromium/src/+/master:build/vs_toolchain.py;l=140-175
	const supportedVersions = ['2022', '2019', '2017'];

	const availableVersions = [];
	for (const version of supportedVersions) {
		let vsPath = process.env[`vs${version}_install`];
		if (vsPath && fs.existsSync(vsPath)) {
			availableVersions.push(version);
			break;
		}
		const programFiles86Path = process.env['ProgramFiles(x86)'];
		const programFiles64Path = process.env['ProgramFiles'];

		if (programFiles64Path) {
			vsPath = `${programFiles64Path}/Microsoft Visual Studio/${version}`;
			const vsTypes = ['Enterprise', 'Professional', 'Community', 'Preview', 'BuildTools'];
			if (vsTypes.some(vsType => fs.existsSync(path.join(vsPath, vsType)))) {
				availableVersions.push(version);
				break;
			}
		}

		if (programFiles86Path) {
			vsPath = `${programFiles86Path}/Microsoft Visual Studio/${version}`;
			const vsTypes = ['Enterprise', 'Professional', 'Community', 'Preview', 'BuildTools'];
			if (vsTypes.some(vsType => fs.existsSync(path.join(vsPath, vsType)))) {
				availableVersions.push(version);
				break;
			}
		}
	}
	return availableVersions.length;
}

function installHeaders() {
	const yarn = 'yarn.cmd';
	const yarnResult = cp.spawnSync(yarn, ['install'], {
		env: process.env,
		cwd: path.join(__dirname, 'gyp'),
		stdio: 'inherit',
		shell: true
	});
	if (yarnResult.error || yarnResult.status !== 0) {
		console.error(`Installing node-gyp failed`);
		err = true;
		return;
	}

	// The node gyp package got installed using the above yarn command using the gyp/package.json
	// file checked into our repository. So from that point it is save to construct the path
	// to that executable
	const node_gyp = path.join(__dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd');
	const result = cp.execFileSync(node_gyp, ['list'], { encoding: 'utf8', shell: true });
	const versions = new Set(result.split(/\n/g).filter(line => !line.startsWith('gyp info')).map(value => value));

	const local = getHeaderInfo(path.join(__dirname, '..', '..', '.yarnrc'));
	const remote = getHeaderInfo(path.join(__dirname, '..', '..', 'remote', '.yarnrc'));

	if (local !== undefined && !versions.has(local.target)) {
		// Both disturl and target come from a file checked into our repository
		cp.execFileSync(node_gyp, ['install', '--dist-url', local.disturl, local.target], { shell: true });
	}

	// Avoid downloading headers for Windows arm64 till we move to Nodejs v19 in remote
	// which is the first official release with support for the architecture. Downloading
	// the headers for older versions now redirect to https://origin.nodejs.org/404.html
	// which causes checksum validation error in node-gyp.
	//
	// gyp http 200 https://origin.nodejs.org/404.html
	// gyp WARN install got an error, rolling back install
	// gyp ERR! install error
	// gyp ERR! stack Error: win-arm64/node.lib local checksum 4c62bed7a032f7b36984321b7ffdd60b596fac870672037ff879ae9ac9548fb7 not match remote undefined
	//
	if (remote !== undefined && !versions.has(remote.target) &&
		process.env['npm_config_arch'] !== "arm64" &&
		process.arch !== "arm64") {
		// Both disturl and target come from a file checked into our repository
		cp.execFileSync(node_gyp, ['install', '--dist-url', remote.disturl, remote.target], { shell: true });
	}
}

/**
 * @param {string} rcFile
 * @returns {{ disturl: string; target: string } | undefined}
 */
function getHeaderInfo(rcFile) {
	const lines = fs.readFileSync(rcFile, 'utf8').split(/\r\n?/g);
	let disturl, target;
	for (const line of lines) {
		let match = line.match(/\s*disturl\s*\"(.*)\"\s*$/);
		if (match !== null && match.length >= 1) {
			disturl = match[1];
		}
		match = line.match(/\s*target\s*\"(.*)\"\s*$/);
		if (match !== null && match.length >= 1) {
			target = match[1];
		}
	}
	return disturl !== undefined && target !== undefined
		? { disturl, target }
		: undefined;
}

/**
 * Merge the package.json files for remote and remote/web into a package.json for remote/reh-web.
 */
function generateRehWebPackageJson() {
	// If both package.json files contain the same dependency, the one from remote/web will be used
	// because it is the last one in the stream.
	gulp.src([
		path.join(__dirname, '..', '..', 'remote', 'package.json'),
		path.join(__dirname, '..', '..', 'remote', 'web', 'package.json'),
	])
		// Merge the package.json files
		.pipe(
			mergeJson({
				fileName: 'package.json',
				// Rename the "name" field to positron-reh-web
				endObj: {
					name: 'positron-reh-web',
				},
				transform: (mergedJson) => {
					// Sort the dependencies alphabetically
					if (mergedJson.dependencies) {
						mergedJson.dependencies = Object.keys(
							mergedJson.dependencies
						)
							.sort()
							.reduce((obj, key) => {
								obj[key] = mergedJson.dependencies[key];
								return obj;
							}, {});
					}
					return mergedJson;
				},
			})
		)
		// Write the merged package.json file to remote/reh-web
		.pipe(gulp.dest(path.join(__dirname, '..', '..', 'remote', 'reh-web')));
}
