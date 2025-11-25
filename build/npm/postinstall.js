/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { dirs } = require('./dirs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = path.dirname(path.dirname(__dirname));

function log(dir, message) {
	if (process.stdout.isTTY) {
		console.log(`\x1b[34m[${dir}]\x1b[0m`, message);
	} else {
		console.log(`[${dir}]`, message);
	}
}

function run(command, args, opts) {
	log(opts.cwd || '.', '$ ' + command + ' ' + args.join(' '));

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
function npmInstall(dir, opts) {
	opts = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: dir,
		stdio: 'inherit',
		shell: true
	};

	const command = process.env['npm_command'] || 'install';

	if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		const userinfo = os.userInfo();
		log(dir, `Installing dependencies inside container ${process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME']}...`);

		opts.cwd = root;
		if (process.env['npm_config_arch'] === 'arm64') {
			run('sudo', ['docker', 'run', '--rm', '--privileged', 'multiarch/qemu-user-static', '--reset', '-p', 'yes'], opts);
		}
		run('sudo', [
			'docker', 'run',
			'-e', 'GITHUB_TOKEN',
			'-v', `${process.env['VSCODE_HOST_MOUNT']}:/root/vscode`,
			'-v', `${process.env['VSCODE_HOST_MOUNT']}/.build/.netrc:/root/.netrc`,
			'-v', `${process.env['VSCODE_NPMRC_PATH']}:/root/.npmrc`,
			'-w', path.resolve('/root/vscode', dir),
			process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'],
			'sh', '-c', `\"chown -R root:root ${path.resolve('/root/vscode', dir)} && export PATH="/root/vscode/.build/nodejs-musl/usr/local/bin:$PATH" && npm i -g node-gyp-build && npm ci\"`
		], opts);
		run('sudo', ['chown', '-R', `${userinfo.uid}:${userinfo.gid}`, `${path.resolve(root, dir)}`], opts);
	} else {
		log(dir, 'Installing dependencies...');
		run(npm, command.split(' '), opts);
	}
}

function setNpmrcConfig(dir, env) {
	const npmrcPath = path.join(root, dir, '.npmrc');
	const lines = fs.readFileSync(npmrcPath, 'utf8').split('\n');

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith('#')) {
			const [key, value] = trimmedLine.split('=');
			env[`npm_config_${key}`] = value.replace(/^"(.*)"$/, '$1');
		}
	}

	// Use our bundled node-gyp version
	env['npm_config_node_gyp'] =
		process.platform === 'win32'
			? path.join(__dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd')
			: path.join(__dirname, 'gyp', 'node_modules', '.bin', 'node-gyp');

	// Force node-gyp to use process.config on macOS
	// which defines clang variable as expected. Otherwise we
	// run into compilation errors due to incorrect compiler
	// configuration.
	// NOTE: This means the process.config should contain
	// the correct clang variable. So keep the version check
	// in preinstall sync with this logic.
	// Change was first introduced in https://github.com/nodejs/node/commit/6e0a2bb54c5bbeff0e9e33e1a0c683ed980a8a0f
	if ((dir === 'remote' || dir === 'build') && process.platform === 'darwin') {
		env['npm_config_force_process_config'] = 'true';
	} else {
		delete env['npm_config_force_process_config'];
	}

	if (dir === 'build') {
		env['npm_config_target'] = process.versions.node;
		env['npm_config_arch'] = process.arch;
	}
}

// --- Start Positron ---
/**
 * Async version of npmInstall for parallel execution
 * @param {string} dir
 * @param {*} [opts]
 */
function npmInstallAsync(dir, opts) {
	return new Promise((resolve, reject) => {
		opts = {
			env: { ...process.env },
			...(opts ?? {}),
			cwd: dir,
			stdio: 'inherit',
			shell: true
		};

		const command = process.env['npm_command'] || 'install';

		// Use synchronous version for Docker-based installs
		if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
			try {
				npmInstall(dir, opts);
				resolve();
			} catch (err) {
				reject(err);
			}
			return;
		}

		log(dir, 'Installing dependencies...');
		const child = cp.spawn(npm, command.split(' '), opts);

		child.on('error', (error) => {
			reject(new Error(`Failed to spawn npm in ${dir}: ${error}`));
		});

		child.on('exit', (code) => {
			if (code !== 0) {
				reject(new Error(`npm install failed in ${dir} with exit code ${code}`));
			} else {
				resolve();
			}
		});
	});
}

/**
 * Run npm installs in parallel with concurrency limit
 * @param {Array<{dir: string, opts: any}>} tasks
 * @param {number} concurrency
 */
async function runBatch(tasks, concurrency) {
	const results = [];
	const executing = [];

	for (const task of tasks) {
		const promise = npmInstallAsync(task.dir, task.opts).then(() => task.dir);
		results.push(promise);

		if (concurrency <= tasks.length) {
			const e = promise.then(() => executing.splice(executing.indexOf(e), 1));
			executing.push(e);
			if (executing.length >= concurrency) {
				await Promise.race(executing);
			}
		}
	}

	return Promise.all(results);
}

/**
 * Merge the package.json files for remote and remote/web into a package.json for remote/reh-web.
 * NOTE: Must be run AFTER `npm install` has been run in the `build` directory and BEFORE `npm install`
 * is run in the `remote/reh-web` directory.
 */
function generateRehWebPackageJson() {
	const gulp = require('gulp');
	// Note: this is a local require because this dependency is only available once the `build`
	// directory has `npm install` executed in it (see for loop below -- `npm install` will be
	// executed for `build` a while before `remote/reh-web` due to the array order of `dirs`).
	const mergeJson = require('gulp-merge-json');

	const remoteDir = path.join(__dirname, '..', '..', 'remote');
	const packageJsonDirPath = path.join(remoteDir, 'reh-web');

	// If both package.json files contain the same dependency, the one from remote/web will be used
	// because it is the last one in the stream.
	gulp.src([
		path.join(remoteDir, 'package.json'),
		path.join(remoteDir, 'web', 'package.json'),
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
		.pipe(gulp.dest(packageJsonDirPath))
		// `git add` the files in remote/reh-web so that line normalization is handled on Windows
		.on('end', () => {
			const packageJsonPath = path.join(packageJsonDirPath, 'package.json');
			cp.execSync(`git add --renormalize ${packageJsonPath}`);
		});
}

// Parallel Installation Support
// =============================
// This section enables faster builds by installing npm dependencies in parallel
// instead of sequentially. It respects all the same configuration options as the
// sequential version (build flags, remote configs, etc.) and is opt-in via env var.
//
// How it works:
// - Collects all 60+ directories that need npm install
// - Runs them in parallel with a configurable concurrency limit (default: 10)
// - Uses async spawn instead of blocking spawnSync for parallelism
//
// Safety:
// - Only enabled when POSITRON_PARALLEL_INSTALL=1 (CI only)
// - Falls back to original sequential behavior when not set
// - Respects all existing configuration (compiler flags, Docker, special handling)
// - Fails fast if any installation fails
//
// Configuration:
// - POSITRON_PARALLEL_INSTALL=1 : Enable parallel mode
// - POSITRON_NPM_CONCURRENCY=N  : Max concurrent installs (default: 10)

// Using this if condition to clearly separate Positron changes
if (true) {
	if (process.env['POSITRON_PARALLEL_INSTALL'] === '1') {
		const concurrency = parseInt(process.env['POSITRON_NPM_CONCURRENCY'] || '10', 10);
		console.log(`Using parallel installation (concurrency: ${concurrency})`);

		// Separate parent directories from nested ones to avoid race conditions
		// Parent dirs (build, extensions, remote) must install first to compile native modules
		const parentTasks = [];
		const nestedTasks = [];

		for (let dir of dirs) {
			if (dir === '') continue;

			let opts;
			if (dir === 'build') {
				opts = { env: { ...process.env } };
				if (process.env['CC']) { opts.env['CC'] = 'gcc'; }
				if (process.env['CXX']) { opts.env['CXX'] = 'g++'; }
				if (process.env['CXXFLAGS']) { opts.env['CXXFLAGS'] = ''; }
				if (process.env['LDFLAGS']) { opts.env['LDFLAGS'] = ''; }
				setNpmrcConfig('build', opts.env);
			} else {
				const isRehWebDir = /^(.build\/distro\/npm\/)?remote\/reh-web$/.test(dir);
				if (/^(.build\/distro\/npm\/)?remote$/.test(dir) || isRehWebDir) {
					opts = { env: { ...process.env } };
					if (process.env['VSCODE_REMOTE_CC']) { opts.env['CC'] = process.env['VSCODE_REMOTE_CC']; } else { delete opts.env['CC']; }
					if (process.env['VSCODE_REMOTE_CXX']) { opts.env['CXX'] = process.env['VSCODE_REMOTE_CXX']; } else { delete opts.env['CXX']; }
					if (process.env['CXXFLAGS']) { delete opts.env['CXXFLAGS']; }
					if (process.env['CFLAGS']) { delete opts.env['CFLAGS']; }
					if (process.env['LDFLAGS']) { delete opts.env['LDFLAGS']; }
					if (process.env['VSCODE_REMOTE_CXXFLAGS']) { opts.env['CXXFLAGS'] = process.env['VSCODE_REMOTE_CXXFLAGS']; }
					if (process.env['VSCODE_REMOTE_LDFLAGS']) { opts.env['LDFLAGS'] = process.env['VSCODE_REMOTE_LDFLAGS']; }
					if (process.env['VSCODE_REMOTE_NODE_GYP']) { opts.env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }
					if (isRehWebDir) { generateRehWebPackageJson(); }
					const globalGypPath = path.join(os.homedir(), '.gyp');
					const globalInclude = path.join(globalGypPath, 'include.gypi');
					const tempGlobalInclude = path.join(globalGypPath, 'include.gypi.bak');
					if (process.platform === 'linux' && (process.env['CI'] || process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'])) {
						if (fs.existsSync(globalInclude)) { fs.renameSync(globalInclude, tempGlobalInclude); }
					}
					setNpmrcConfig('remote', opts.env);
				}
			}

			// Separate parent directories from nested subdirectories
			// Parents (extensions, remote, etc.) contain shared node_modules with native addons
			// that must be compiled before their children can use them
			const isParent = dir === 'build' || dir === 'extensions' || dir === 'remote' ||
				dir === 'remote/web' || dir === 'remote/reh-web';
			if (isParent) {
				parentTasks.push({ dir, opts });
			} else {
				nestedTasks.push({ dir, opts });
			}
		}

		// Install parents first, then nested directories in parallel
		(async () => {
			// Install parent directories sequentially to avoid native module race conditions
			// These directories contain complex native addons (node-gyp builds) that can fail
			// if dependencies aren't fully resolved before compilation starts
			console.log(`Installing ${parentTasks.length} parent directories sequentially...`);
			await runBatch(parentTasks, 1); // concurrency=1 for parents

			// Nested directories (extensions) are simpler and can safely run in parallel
			console.log(`Installing ${nestedTasks.length} nested directories in parallel...`);
			await runBatch(nestedTasks, concurrency);

			cp.execSync('git config pull.rebase merges');
			cp.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
		})().catch((err) => {
			console.error('Parallel installation failed:', err);
			process.exit(1);
		});
	} else {
		for (let dir of dirs) {

			if (dir === '') {
				// already executed in root
				continue;
			}

			let opts;

			if (dir === 'build') {
				opts = {
					env: {
						...process.env
					},
				}
				if (process.env['CC']) { opts.env['CC'] = 'gcc'; }
				if (process.env['CXX']) { opts.env['CXX'] = 'g++'; }
				if (process.env['CXXFLAGS']) { opts.env['CXXFLAGS'] = ''; }
				if (process.env['LDFLAGS']) { opts.env['LDFLAGS'] = ''; }

				setNpmrcConfig('build', opts.env);
				npmInstall('build', opts);
				continue;
			}

			const isRehWebDir = /^(.build\/distro\/npm\/)?remote\/reh-web$/.test(dir);

			if (/^(.build\/distro\/npm\/)?remote$/.test(dir) || isRehWebDir) {
				// node modules used by vscode server
				opts = {
					env: {
						...process.env
					},
				}
				if (process.env['VSCODE_REMOTE_CC']) {
					opts.env['CC'] = process.env['VSCODE_REMOTE_CC'];
				} else {
					delete opts.env['CC'];
				}
				if (process.env['VSCODE_REMOTE_CXX']) {
					opts.env['CXX'] = process.env['VSCODE_REMOTE_CXX'];
				} else {
					delete opts.env['CXX'];
				}
				if (process.env['CXXFLAGS']) { delete opts.env['CXXFLAGS']; }
				if (process.env['CFLAGS']) { delete opts.env['CFLAGS']; }
				if (process.env['LDFLAGS']) { delete opts.env['LDFLAGS']; }
				if (process.env['VSCODE_REMOTE_CXXFLAGS']) { opts.env['CXXFLAGS'] = process.env['VSCODE_REMOTE_CXXFLAGS']; }
				if (process.env['VSCODE_REMOTE_LDFLAGS']) { opts.env['LDFLAGS'] = process.env['VSCODE_REMOTE_LDFLAGS']; }
				if (process.env['VSCODE_REMOTE_NODE_GYP']) { opts.env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }

				if (isRehWebDir) {
					// This ensures that the `remote/reh-web` package.json file is created/updated before
					// `npm install` is run, so the package-lock.json and node_modules are created/updated
					// with the appropriate dependencies. This will create a side effect of needing to
					// commit the changes to the `remote/reh-web` package.json and package-lock.json files if
					// they are updated.
					generateRehWebPackageJson();
				}

				const globalGypPath = path.join(os.homedir(), '.gyp');
				const globalInclude = path.join(globalGypPath, 'include.gypi');
				const tempGlobalInclude = path.join(globalGypPath, 'include.gypi.bak');
				if (process.platform === 'linux' &&
					(process.env['CI'] || process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'])) {
					// Following include file rename should be removed
					// when `Override gnu target for arm64 and arm` step
					// is removed from the product build pipeline.
					if (fs.existsSync(globalInclude)) {
						fs.renameSync(globalInclude, tempGlobalInclude);
					}
				}

				setNpmrcConfig('remote', opts.env);
				npmInstall(dir, opts);
				continue;
			}

			npmInstall(dir, opts);
		}
	}
	// --- End Positron ---
	// Using the else branch to clearly separate Upstream code
} else {
	for (let dir of dirs) {

		if (dir === '') {
			// already executed in root
			continue;
		}

		let opts;

		if (dir === 'build') {
			opts = {
				env: {
					...process.env
				},
			}
			if (process.env['CC']) { opts.env['CC'] = 'gcc'; }
			if (process.env['CXX']) { opts.env['CXX'] = 'g++'; }
			if (process.env['CXXFLAGS']) { opts.env['CXXFLAGS'] = ''; }
			if (process.env['LDFLAGS']) { opts.env['LDFLAGS'] = ''; }

			setNpmrcConfig('build', opts.env);
			npmInstall('build', opts);
			continue;
		}

		if (/^(.build\/distro\/npm\/)?remote$/.test(dir)) {
			// node modules used by vscode server
			opts = {
				env: {
					...process.env
				},
			}
			if (process.env['VSCODE_REMOTE_CC']) {
				opts.env['CC'] = process.env['VSCODE_REMOTE_CC'];
			} else {
				delete opts.env['CC'];
			}
			if (process.env['VSCODE_REMOTE_CXX']) {
				opts.env['CXX'] = process.env['VSCODE_REMOTE_CXX'];
			} else {
				delete opts.env['CXX'];
			}
			if (process.env['CXXFLAGS']) { delete opts.env['CXXFLAGS']; }
			if (process.env['CFLAGS']) { delete opts.env['CFLAGS']; }
			if (process.env['LDFLAGS']) { delete opts.env['LDFLAGS']; }
			if (process.env['VSCODE_REMOTE_CXXFLAGS']) { opts.env['CXXFLAGS'] = process.env['VSCODE_REMOTE_CXXFLAGS']; }
			if (process.env['VSCODE_REMOTE_LDFLAGS']) { opts.env['LDFLAGS'] = process.env['VSCODE_REMOTE_LDFLAGS']; }
			if (process.env['VSCODE_REMOTE_NODE_GYP']) { opts.env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }

			const globalGypPath = path.join(os.homedir(), '.gyp');
			const globalInclude = path.join(globalGypPath, 'include.gypi');
			const tempGlobalInclude = path.join(globalGypPath, 'include.gypi.bak');
			if (process.platform === 'linux' &&
				(process.env['CI'] || process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'])) {
				// Following include file rename should be removed
				// when `Override gnu target for arm64 and arm` step
				// is removed from the product build pipeline.
				if (fs.existsSync(globalInclude)) {
					fs.renameSync(globalInclude, tempGlobalInclude);
				}
			}

			setNpmrcConfig('remote', opts.env);
			npmInstall(dir, opts);
			continue;
		}

		npmInstall(dir, opts);
	}
}
cp.execSync('git config pull.rebase merges');
cp.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
