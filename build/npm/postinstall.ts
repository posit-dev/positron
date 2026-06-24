/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { createRequire } from 'module';
import { dirs } from './dirs.ts';
import { root, stateFile, stateContentsFile, computeState, computeContents, isUpToDate } from './installStateHash.ts';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootNpmrcConfigKeys = getNpmrcConfigKeys(path.join(root, '.npmrc'));

function log(dir: string, message: string) {
	if (process.stdout.isTTY) {
		console.log(`\x1b[34m[${dir}]\x1b[0m`, message);
	} else {
		console.log(`[${dir}]`, message);
	}
}

function run(command: string, args: string[], opts: child_process.SpawnSyncOptions) {
	log(opts.cwd as string || '.', '$ ' + command + ' ' + args.join(' '));

	const result = child_process.spawnSync(command, args, opts);

	if (result.error) {
		console.error(`ERR Failed to spawn process: ${result.error}`);
		process.exit(1);
	} else if (result.status !== 0) {
		console.error(`ERR Process exited with code: ${result.status}`);
		process.exit(result.status);
	}
}

function spawnAsync(command: string, args: string[], opts: child_process.SpawnOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = child_process.spawn(command, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
		child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error(`Process exited with code: ${code}\n${output}`));
			} else {
				resolve(output);
			}
		});
	});
}

async function npmInstallAsync(dir: string, opts?: child_process.SpawnOptions): Promise<void> {
	const finalOpts: child_process.SpawnOptions = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: path.join(root, dir),
		shell: true,
	};

	const command = process.env['npm_command'] || 'install';

	if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		const syncOpts: child_process.SpawnSyncOptions = {
			env: finalOpts.env,
			cwd: root,
			stdio: 'inherit',
			shell: true,
		};
		const userinfo = os.userInfo();
		log(dir, `Installing dependencies inside container ${process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME']}...`);

		if (process.env['npm_config_arch'] === 'arm64') {
			run('sudo', ['docker', 'run', '--rm', '--privileged', 'vscodehub.azurecr.io/multiarch/qemu-user-static@sha256:fe60359c92e86a43cc87b3d906006245f77bfc0565676b80004cc666e4feb9f0', '--reset', '-p', 'yes'], syncOpts);
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
		], syncOpts);
		run('sudo', ['chown', '-R', `${userinfo.uid}:${userinfo.gid}`, `${path.resolve(root, dir)}`], syncOpts);
	} else {
		log(dir, 'Installing dependencies...');
		const output = await spawnAsync(npm, command.split(' '), finalOpts);
		if (output.trim()) {
			for (const line of output.trim().split('\n')) {
				log(dir, line);
			}
		}
	}
	removeParcelWatcherPrebuild(dir);
}

function setNpmrcConfig(dir: string, env: NodeJS.ProcessEnv) {
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
			? path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd')
			: path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp');

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

function removeParcelWatcherPrebuild(dir: string) {
	const parcelModuleFolder = path.join(root, dir, 'node_modules', '@parcel');
	if (!fs.existsSync(parcelModuleFolder)) {
		return;
	}

	const parcelModules = fs.readdirSync(parcelModuleFolder);
	for (const moduleName of parcelModules) {
		if (moduleName.startsWith('watcher-')) {
			const modulePath = path.join(parcelModuleFolder, moduleName);
			fs.rmSync(modulePath, { recursive: true, force: true });
			log(dir, `Removed @parcel/watcher prebuilt module ${modulePath}`);
		}
	}
}

function getNpmrcConfigKeys(npmrcPath: string): string[] {
	if (!fs.existsSync(npmrcPath)) {
		return [];
	}
	const lines = fs.readFileSync(npmrcPath, 'utf8').split('\n');
	const keys: string[] = [];
	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith('#')) {
			const eqIndex = trimmedLine.indexOf('=');
			if (eqIndex > 0) {
				keys.push(trimmedLine.substring(0, eqIndex).trim());
			}
		}
	}
	return keys;
}

function clearInheritedNpmrcConfig(dir: string, env: NodeJS.ProcessEnv): void {
	const dirNpmrcPath = path.join(root, dir, '.npmrc');
	if (fs.existsSync(dirNpmrcPath)) {
		return;
	}

	for (const key of rootNpmrcConfigKeys) {
		const envKey = `npm_config_${key.replace(/-/g, '_')}`;
		delete env[envKey];
	}
}

// --- Start Positron ---
/**
 * Reads a single key's value from an .npmrc file, stripping surrounding quotes.
 * Returns undefined if the file or key is absent.
 */
function readNpmrcValue(npmrcPath: string, key: string): string | undefined {
	if (!fs.existsSync(npmrcPath)) {
		return undefined;
	}
	for (const line of fs.readFileSync(npmrcPath, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		if (eq <= 0 || trimmed.substring(0, eq).trim() !== key) {
			continue;
		}
		return trimmed.substring(eq + 1).trim().replace(/^"(.*)"$/, '$1');
	}
	return undefined;
}

/**
 * positron-data-driver-sqlite depends on the native module better-sqlite3, which
 * the extension install compiles for Electron's ABI (the desktop extension host
 * runs under Electron's Node; see the extension's .npmrc and the root .npmrc).
 * The same SQLite worker also runs in the server/remote extension host, which is
 * plain Node.js with a different ABI, so the Electron binary fails to load there
 * with a NODE_MODULE_VERSION mismatch.
 *
 * Fetch a Node-ABI build of the addon and stash it next to the default Electron
 * one as `better_sqlite3-node.node`. The worker (sqliteWorker.ts) loads this
 * variant when it is not running under Electron. The Node target is read from
 * remote/.npmrc so it stays in sync with the version the server build uses.
 */
async function buildSqliteServerBinding(): Promise<void> {
	const dir = 'extensions/positron-data-driver-sqlite';
	const moduleDir = path.join(root, dir, 'node_modules', 'better-sqlite3');
	const releaseDir = path.join(moduleDir, 'build', 'Release');
	const defaultBinary = path.join(releaseDir, 'better_sqlite3.node');
	const serverBinary = path.join(releaseDir, 'better_sqlite3-node.node');

	// Skip if the extension was not installed in this pass (e.g. a filtered
	// POSITRON_EXTENSIONS_FILTER install that excludes it).
	if (!fs.existsSync(defaultBinary)) {
		return;
	}

	// The default binary is the Electron-ABI build. A correct server binding is a
	// *distinct* (Node-ABI) build, so if a server binary already exists and differs
	// from the default, it is already good -- skip the (network-bound) rebuild. This
	// makes the step idempotent and cheap, so it can also run on the "up to date"
	// path to self-heal a missing or stale (Electron-ABI) server binary. A server
	// binary byte-identical to the default is the failure we must repair: it means a
	// previous run copied the Electron binary without rebuilding it.
	const electronBinary = fs.readFileSync(defaultBinary);
	if (fs.existsSync(serverBinary) && !fs.readFileSync(serverBinary).equals(electronBinary)) {
		return;
	}

	const nodeTarget = readNpmrcValue(path.join(root, 'remote', '.npmrc'), 'target') ?? process.versions.node;
	log(dir, `Building Node-ABI (node ${nodeTarget}) better-sqlite3 binary for the server extension host...`);

	// prebuild-install / node-gyp both write to build/Release/better_sqlite3.node,
	// so preserve the Electron binary, produce the Node binary, copy it aside, then
	// restore the Electron binary as the default.
	const requireFromModule = createRequire(path.join(moduleDir, 'package.json'));
	try {
		try {
			const prebuildInstall = requireFromModule.resolve('prebuild-install/bin.js');
			await spawnAsync(process.execPath, [prebuildInstall, '-r', 'node', '-t', nodeTarget, '--tag-prefix', 'v', '--arch', process.arch], { cwd: moduleDir });
		} catch (prebuildErr) {
			// No prebuilt Node-ABI binary for this platform (e.g. musl): build from
			// source against the Node headers for the target version. The postinstall
			// process itself runs under Node, so node-gyp emits a Node-ABI binary.
			log(dir, `prebuild-install unavailable (${prebuildErr instanceof Error ? prebuildErr.message.split('\n')[0] : prebuildErr}); building from source...`);
			const nodeGyp = process.platform === 'win32'
				? path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp.cmd')
				: path.join(import.meta.dirname, 'gyp', 'node_modules', '.bin', 'node-gyp');
			await spawnAsync(nodeGyp, ['rebuild', '--release', `--target=${nodeTarget}`, `--arch=${process.arch}`, '--dist-url=https://nodejs.org/dist'], { cwd: moduleDir, shell: true });
		}
		// Verify the rebuild actually produced a Node-ABI binary before copying it.
		// If the default is still byte-identical to the Electron binary, the rebuild
		// silently no-op'd (e.g. a download that exited 0 without overwriting); fail
		// loudly rather than ship an Electron-ABI binary that the server extension
		// host cannot load (NODE_MODULE_VERSION mismatch).
		if (fs.readFileSync(defaultBinary).equals(electronBinary)) {
			throw new Error(`better-sqlite3 Node-ABI rebuild (node ${nodeTarget}) did not replace the Electron binary; refusing to write an Electron-ABI server binding. Re-run with VSCODE_FORCE_INSTALL=1 and network access.`);
		}
		fs.copyFileSync(defaultBinary, serverBinary);
		log(dir, `Wrote ${path.relative(root, serverBinary)}`);
	} finally {
		fs.writeFileSync(defaultBinary, electronBinary);
	}
}

/**
 * Merge the package.json files for remote and remote/web into a package.json for remote/reh-web.
 * NOTE: Must be run AFTER `npm install` has been run in the `build` directory and BEFORE `npm install`
 * is run in the `remote/reh-web` directory.
 */
function generateRehWebPackageJson() {
	// Note: these are dynamic imports because these dependencies are only available once the
	// `build` directory has `npm install` executed in it (see for loop below -- `npm install`
	// will be executed for `build` a while before `remote/reh-web` due to the array order of
	// `dirs`).
	const require = createRequire(import.meta.url);
	const gulp = require('gulp');
	const mergeJson = require('gulp-merge-json');

	const remoteDir = path.join(import.meta.dirname, '..', '..', 'remote');
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
				// Rename "name" to positron-reh-web and add "product-label" used by
				// Workbench's nginx static URL routing.
				endObj: {
					name: 'positron-reh-web',
					'product-label': 'positron',
				},
				transform: (mergedJson: { dependencies?: { [x: string]: any } }) => {
					// Sort the dependencies alphabetically
					if (mergedJson.dependencies) {
						mergedJson.dependencies = Object.keys(
							mergedJson.dependencies
						)
							.sort()
							.reduce((obj, key: string) => {
								obj[key] = mergedJson.dependencies![key];
								return obj;
							}, {} as { [key: string]: any });
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
			child_process.execSync(`git add --renormalize ${packageJsonPath}`);
		});
}

/**
 * If the ark submodule pointer recorded in this commit differs from what's
 * currently checked out in `extensions/positron-r/ark`, sync it — but only
 * when it's safe to do so. "Safe" means: the current submodule HEAD is
 * detached and is an ancestor of ark's `origin/main` (i.e., no in-progress
 * dev work would be lost). Anything else (named branch, unmerged commits,
 * offline, CI) is left alone.
 *
 * Runs before the dirs loop so the subsequent extensions install (which
 * triggers install-kernel) sees the synced submodule contents.
 */
async function syncArkSubmoduleIfSafe(): Promise<void> {
	// Skip in CI — checkouts there already pin the submodule via `submodules: true`.
	if (process.env['CI']) {
		log('.', 'Skipping ark submodule sync in CI environment');
		return;
	}

	const submodulePath = 'extensions/positron-r/ark';
	const submoduleAbs = path.join(root, submodulePath);

	// Not initialized yet — install-kernel's ensureSubmoduleReady handles that path.
	if (!fs.existsSync(path.join(submoduleAbs, '.git'))) {
		return;
	}

	const exec = (cmd: string, cwd: string) =>
		child_process.execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

	// Compare recorded pointer vs. checked-out HEAD.
	let recordedSha: string;
	let currentSha: string;
	try {
		const lsTree = exec(`git ls-tree HEAD ${submodulePath}`, root);
		recordedSha = lsTree.split(/\s+/)[2];
		currentSha = exec('git rev-parse HEAD', submoduleAbs);
	} catch {
		return;
	}
	if (!recordedSha || recordedSha === currentSha) {
		return;
	}

	// Don't detach from a named branch — even if reachable from main, the dev is
	// likely actively using it.
	try {
		const branch = exec('git symbolic-ref --quiet --short HEAD', submoduleAbs);
		if (branch) {
			log(submodulePath,
				`Pointer differs (${currentSha.slice(0, 7)} → ${recordedSha.slice(0, 7)}), ` +
				`but ark is on branch '${branch}'. Skipping auto-sync.`);
			return;
		}
	} catch {
		// Detached HEAD — symbolic-ref exits non-zero, which is what we want.
	}

	// Refresh origin/main inside the submodule so the ancestor check is meaningful.
	// Offline → skip silently; the dev can sync manually when they're back online.
	try {
		exec('git fetch --quiet origin main', submoduleAbs);
	} catch {
		return;
	}

	// Safety gate: only sync if current HEAD has no commits beyond ark's origin/main.
	try {
		exec('git merge-base --is-ancestor HEAD origin/main', submoduleAbs);
	} catch {
		log(submodulePath,
			`Pointer differs (${currentSha.slice(0, 7)} → ${recordedSha.slice(0, 7)}), ` +
			`but HEAD is not reachable from ark's origin/main — looks like in-progress ` +
			`work. Skipping. Run \`git submodule update -- ${submodulePath}\` to sync manually.`);
		return;
	}

	log(submodulePath, `Syncing ark submodule ${currentSha.slice(0, 7)} → ${recordedSha.slice(0, 7)}...`);
	run('git', ['submodule', 'update', '--', submodulePath], { cwd: root, stdio: 'inherit' });
}
// --- End Positron ---

function ensureAgentHarnessLink(sourceRelativePath: string, linkPath: string): 'existing' | 'junction' | 'symlink' | 'hard link' {
	if (fs.existsSync(linkPath)) {
		return 'existing';
	}

	const sourcePath = path.resolve(path.dirname(linkPath), sourceRelativePath);
	const isDirectory = fs.statSync(sourcePath).isDirectory();

	try {
		if (process.platform === 'win32' && isDirectory) {
			fs.symlinkSync(sourcePath, linkPath, 'junction');
			return 'junction';
		}

		fs.symlinkSync(sourceRelativePath, linkPath, isDirectory ? 'dir' : 'file');
		return 'symlink';
	} catch (error) {
		if (process.platform === 'win32' && !isDirectory && (error as NodeJS.ErrnoException).code === 'EPERM') {
			fs.linkSync(sourcePath, linkPath);
			return 'hard link';
		}

		throw error;
	}
}

async function runWithConcurrency(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
	const errors: Error[] = [];
	let index = 0;

	async function worker() {
		while (index < tasks.length) {
			const i = index++;
			try {
				await tasks[i]();
			} catch (err) {
				errors.push(err as Error);
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

	if (errors.length > 0) {
		for (const err of errors) {
			console.error(err.message);
		}
		process.exit(1);
	}
}

async function main() {
	// --- Start Positron ---
	// Sync the ark submodule before anything else — extensions install runs
	// install-kernel, which reads the submodule's working tree.
	try {
		await syncArkSubmoduleIfSafe();
	} catch (err) {
		console.error('Error in syncArkSubmoduleIfSafe:', err);
		throw err;
	}
	// --- End Positron ---

	if (!process.env['VSCODE_FORCE_INSTALL'] && isUpToDate()) {
		log('.', 'All dependencies up to date, skipping postinstall.');
		// Even when no dependencies changed, ensure the SQLite server (Node-ABI)
		// binding exists and is not a stale Electron-ABI copy. This is idempotent
		// and cheap when the binary is already correct (see buildSqliteServerBinding),
		// so a cached/already-installed node_modules still gets repaired here.
		await buildSqliteServerBinding();
		child_process.execSync('git config pull.rebase merges');
		child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
		return;
	}

	const _state = computeState();

	const nativeTasks: (() => Promise<void>)[] = [];
	const parallelTasks: (() => Promise<void>)[] = [];

	for (const dir of dirs) {
		if (dir === '') {
			removeParcelWatcherPrebuild(dir);
			continue; // already executed in root
		}

		if (dir === 'build') {
			nativeTasks.push(() => {
				const env: NodeJS.ProcessEnv = { ...process.env };
				if (process.env['CC']) { env['CC'] = 'gcc'; }
				if (process.env['CXX']) { env['CXX'] = 'g++'; }
				if (process.env['CXXFLAGS']) { env['CXXFLAGS'] = ''; }
				if (process.env['LDFLAGS']) { env['LDFLAGS'] = ''; }
				setNpmrcConfig('build', env);
				return npmInstallAsync('build', { env });
			});
			continue;
		}

		if (/^(.build\/distro\/npm\/)?remote$/.test(dir)) {
			const remoteDir = dir;
			nativeTasks.push(() => {
				const env: NodeJS.ProcessEnv = { ...process.env };
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
				setNpmrcConfig('remote', env);
				return npmInstallAsync(remoteDir, { env });
			});
			continue;
		}

		// --- Start Positron ---
		const isRehWebDir = /^(.build\/distro\/npm\/)?remote\/reh-web$/.test(dir);
		if (isRehWebDir) {
			const rehWebDir = dir;
			nativeTasks.push(() => {
				const env: NodeJS.ProcessEnv = { ...process.env };
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
				generateRehWebPackageJson();
				setNpmrcConfig('remote', env);
				return npmInstallAsync(rehWebDir, { env });
			});
			continue;
		}

		// extensions contains native modules (@parcel/watcher) that need sequential installation
		// to avoid node-gyp race conditions during parallel builds
		if (dir === 'extensions') {
			nativeTasks.push(() => {
				const env = { ...process.env };
				clearInheritedNpmrcConfig(dir, env);
				return npmInstallAsync(dir, { env });
			});
			continue;
		}
		// --- End Positron ---

		const taskDir = dir;
		parallelTasks.push(() => {
			const env = { ...process.env };
			clearInheritedNpmrcConfig(taskDir, env);
			return npmInstallAsync(taskDir, { env });
		});
	}

	// Native dirs (build, remote) run sequentially to avoid node-gyp conflicts
	for (const task of nativeTasks) {
		await task();
	}

	// JS-only dirs run in parallel
	const concurrency = Math.min(os.cpus().length, 8);
	log('.', `Running ${parallelTasks.length} npm installs with concurrency ${concurrency}...`);
	await runWithConcurrency(parallelTasks, concurrency);

	// --- Start Positron ---
	// The SQLite data driver's native binding must also load in the server/remote
	// extension host (plain Node, a different ABI than the desktop Electron host).
	await buildSqliteServerBinding();
	// --- End Positron ---

	child_process.execSync('git config pull.rebase merges');
	child_process.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');

	// --- Start Positron ---
	// Build ESM package dependencies once during postinstall for reuse across all build pipelines.
	// Dynamic import to avoid loading esbuild before the build directory's npm install completes.
	try {
		console.log('Building ESM package dependencies...');
		const { buildESMPackageDependencies } = await import('./build-esm-package-dependencies.ts');
		buildESMPackageDependencies('.build/esm-package-dependencies');
		console.log('ESM package dependencies built successfully.');
	} catch (err) {
		console.error('Error building ESM package dependencies:', err);
		throw err;
	}
	// --- End Positron ---

	fs.writeFileSync(stateFile, JSON.stringify(_state));
	fs.writeFileSync(stateContentsFile, JSON.stringify(computeContents()));

	// Symlink .claude/ files to their canonical locations to test Claude agent harness
	const claudeDir = path.join(root, '.claude');
	fs.mkdirSync(claudeDir, { recursive: true });

	const claudeMdLink = path.join(claudeDir, 'CLAUDE.md');
	const claudeMdLinkType = ensureAgentHarnessLink(path.join('..', '.github', 'copilot-instructions.md'), claudeMdLink);
	if (claudeMdLinkType !== 'existing') {
		log('.', `Created ${claudeMdLinkType} .claude/CLAUDE.md -> .github/copilot-instructions.md`);
	}

	const claudeSkillsLink = path.join(claudeDir, 'skills');
	const claudeSkillsLinkType = ensureAgentHarnessLink(path.join('..', '.agents', 'skills'), claudeSkillsLink);
	if (claudeSkillsLinkType !== 'existing') {
		log('.', `Created ${claudeSkillsLinkType} .claude/skills -> .agents/skills`);
	}

	// Temporary: patch @github/copilot-sdk session.js to fix ESM import
	// (missing .js extension on vscode-jsonrpc/node). Fixed upstream in v0.1.32.
	// TODO: Remove once @github/copilot-sdk is updated to >=0.1.32
	for (const dir of ['', 'remote']) {
		const sessionFile = path.join(root, dir, 'node_modules', '@github', 'copilot-sdk', 'dist', 'session.js');
		if (fs.existsSync(sessionFile)) {
			const content = fs.readFileSync(sessionFile, 'utf8');
			const patched = content.replace(/from "vscode-jsonrpc\/node"/g, 'from "vscode-jsonrpc/node.js"');
			if (content !== patched) {
				fs.writeFileSync(sessionFile, patched);
				log(dir || '.', 'Patched @github/copilot-sdk session.js (vscode-jsonrpc ESM import fix)');
			}
		}
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
