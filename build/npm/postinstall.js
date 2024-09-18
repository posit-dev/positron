/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { dirs } = require('./dirs');
const { setupBuildYarnrc } = require('./setupBuildYarnrc');
const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const root = path.dirname(path.dirname(__dirname));

function run(command, args, opts) {
	console.log('$ ' + command + ' ' + args.join(' '));

	const result = cp.spawnSync(command, args, opts);

	if (result.error) {
		console.error(`ERR Failed to spawn process: ${result.error}`);
		process.exit(1);
	} else if (result.status !== 0) {
		console.error(`ERR Process exited with code: ${result.status}`);
		process.exit(result.status);
	}
}

/**
 * @param {string} dir
 * @param {*} [opts]
 */
function yarnInstall(dir, opts) {
	opts = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: dir,
		stdio: 'inherit',
		shell: true
	};

	const raw = process.env['npm_config_argv'] || '{}';
	const argv = JSON.parse(raw);
	const original = argv.original || [];
	const args = original.filter(arg => arg === '--ignore-optional' || arg === '--frozen-lockfile' || arg === '--check-files');

	if (opts.ignoreEngines) {
		args.push('--ignore-engines');
		delete opts.ignoreEngines;
	}

	if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		const userinfo = os.userInfo();
		console.log(`Installing dependencies in ${dir} inside container ${process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME']}...`);

		opts.cwd = root;
		if (process.env['npm_config_arch'] === 'arm64') {
			run('sudo', ['docker', 'run', '--rm', '--privileged', 'multiarch/qemu-user-static', '--reset', '-p', 'yes'], opts);
		}
		run('sudo', ['docker', 'run', '-e', 'GITHUB_TOKEN', '-e', 'npm_config_arch', '-v', `${process.env['VSCODE_HOST_MOUNT']}:/root/vscode`, '-v', `${process.env['VSCODE_HOST_MOUNT']}/.build/.netrc:/root/.netrc`, process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'], 'yarn', '--cwd', dir, ...args], opts);
		run('sudo', ['chown', '-R', `${userinfo.uid}:${userinfo.gid}`, `${dir}/node_modules`], opts);
	} else {
		console.log(`Installing dependencies in ${dir}...`);
		run(yarn, args, opts);
	}
}

// --- Start Positron ---
/**
 * Merge the package.json files for remote and remote/web into a package.json for remote/reh-web.
 * NOTE: Must be run AFTER `yarn` has been run in the `build` directory and before `yarn` is run in
 * the `remote/reh-web` directory.
 */
function generateRehWebPackageJson() {
	const gulp = require('gulp');
	// Note: this is a local require because this dependency is only available once the `build`
	// directory has `yarn` executed in it (see for loop below -- `yarn` will be executed for
	// `build` a while before `remote/reh-web` due to the array order of `dirs`).
	const mergeJson = require('gulp-merge-json');

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
// --- End Positron ---

for (let dir of dirs) {

	if (dir === '') {
		// `yarn` already executed in root
		continue;
	}

	if (/^.build\/distro\/npm(\/?)/.test(dir)) {
		const ossPath = path.relative('.build/distro/npm', dir);
		const ossYarnRc = path.join(ossPath, '.yarnrc');

		if (fs.existsSync(ossYarnRc)) {
			fs.cpSync(ossYarnRc, path.join(dir, '.yarnrc'));
		}
	}

	let opts;

	if (dir === 'build') {
		const env = { ...process.env };
		setupBuildYarnrc();
		opts = { env };
		if (process.env['CC']) { env['CC'] = 'gcc'; }
		if (process.env['CXX']) { env['CXX'] = 'g++'; }
		if (process.env['CXXFLAGS']) { env['CXXFLAGS'] = ''; }
		if (process.env['LDFLAGS']) { env['LDFLAGS'] = ''; }
		yarnInstall('build', opts);
		continue;
	}

	// --- Start Positron ---
	const isRehWebDir = /^(.build\/distro\/npm\/)?remote\/reh-web$/.test(dir);

	if (/^(.build\/distro\/npm\/)?remote$/.test(dir) || isRehWebDir) {
	// --- End Positron ---
		// node modules used by vscode server
		const env = { ...process.env };
		if (process.env['VSCODE_REMOTE_CC']) {
			env['CC'] = process.env['VSCODE_REMOTE_CC'];
		} else {
			delete env['CC'];
		}
		if (process.env['VSCODE_REMOTE_CXX']) {
			env['CXX'] = process.env['VSCODE_REMOTE_CXX'];
		} else {
			delete env['CXX'];
		}
		if (process.env['CXXFLAGS']) { delete env['CXXFLAGS']; }
		if (process.env['CFLAGS']) { delete env['CFLAGS']; }
		if (process.env['LDFLAGS']) { delete env['LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_CXXFLAGS']) { env['CXXFLAGS'] = process.env['VSCODE_REMOTE_CXXFLAGS']; }
		if (process.env['VSCODE_REMOTE_LDFLAGS']) { env['LDFLAGS'] = process.env['VSCODE_REMOTE_LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_NODE_GYP']) { env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }

		opts = { env };

		// --- Start Positron ---
		if (isRehWebDir) {
			// This ensures that the `remote/reh-web` package.json file is created/updated before
			// `yarn` is run, so the yarn.lock and node_modules are created/updated with the
			// appropriate dependencies. This will create a side effect of needing to commit the
			// changes to the `remote/reh-web` package.json and yarn.lock files if they are updated.
			generateRehWebPackageJson();
		}
		// --- End Positron ---
	} else if (/^extensions\//.test(dir)) {
		opts = { ignoreEngines: true };
	}

	yarnInstall(dir, opts);
}

cp.execSync('git config pull.rebase merges');
cp.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
