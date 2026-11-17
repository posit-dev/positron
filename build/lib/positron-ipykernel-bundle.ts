/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';

/**
 * The ipykernel bundle of the packaged positron-python extension.
 *
 * positron-python bundles ipykernel and its dependencies, so that a Python
 * console starts in an environment without ipykernel. `bundleIPykernel()` in
 * extensions/positron-python/gulpfile.js installs them under
 * `python_files/lib/ipykernel/`:
 * - `py3/`: the pure-Python packages, for every architecture.
 * - `<arch>/cp3/`: psutil and tornado, for each architecture.
 * - `<arch>/<cpx>/` (on macOS, `universal2/<cpx>/`): pyzmq, for each Python
 *   version in `IPYKERNEL_CPX_DIRS`.
 *
 * `getIpykernelBundle()` in extensions/positron-python/src/client/positron/ipykernel.ts
 * selects these folders for the interpreter. When one is missing, the console
 * starts only if ipykernel is installed in the environment, and asks the user to
 * install it otherwise. The e2e tests install ipykernel in their environments,
 * so they do not see a missing folder. `checkIpykernelBundle` therefore checks
 * the packaged tree.
 */

/** The folder of the bundle, relative to the packaged `extensions/` directory. */
export const IPYKERNEL_BUNDLE_DIR = 'positron-python/python_files/lib/ipykernel';

/**
 * The pyzmq folders, one for each Python version that has its own wheel, and one
 * abi3 folder for Python 3.12 and later. Keep in sync with `cpxInstalls` in
 * extensions/positron-python/gulpfile.js and `getIpykernelBundle()` in ipykernel.ts.
 */
export const IPYKERNEL_CPX_DIRS: readonly string[] = ['cp310', 'cp311', 'cp312-abi3'];

/** A file that each folder holds when its install completed. */
const PY3_MARKER = 'ipykernel/__init__.py';
const CP3_MARKERS = ['psutil/__init__.py', 'tornado/__init__.py'];
const CPX_MARKER = 'zmq/__init__.py';

/**
 * The architecture folders that a build target must ship, or undefined when the
 * bundle has no rule for the target. The platform and arch are the names of the
 * gulp build targets.
 * - macOS ships both architectures, because each one can run a Python of the
 *   other architecture through Rosetta.
 * - The Windows arm64 build ships both architectures, because Windows ARM64 can
 *   run x64 Python through emulation. The x64 installer does not install on
 *   Windows ARM64, so the x64 build ships only x64.
 * - Linux ships the target architecture only.
 */
export function expectedIpykernelArchs(platform: string, arch: string): readonly string[] | undefined {
	if (arch !== 'x64' && arch !== 'arm64') {
		return undefined;
	}
	switch (platform) {
		case 'darwin':
			return ['x64', 'arm64'];
		case 'win32':
			return arch === 'arm64' ? ['x64', 'arm64'] : ['x64'];
		case 'linux':
			return [arch];
		default:
			return undefined;
	}
}

/**
 * Checks the ipykernel bundle of a packaged tree, and returns a message for each
 * problem. `extensionsDir` is the packaged `extensions/` directory. When the tree
 * does not ship positron-python, or the target has no rule in
 * `expectedIpykernelArchs`, there is nothing to check.
 *
 * The check fails when:
 * - a folder that `getIpykernelBundle()` can select is missing, or its install
 *   is incomplete
 * - an architecture folder ships that the target does not use (a cross-build
 *   that bundled the host architecture, or a build that ships a folder that no
 *   install of it can load)
 */
export function checkIpykernelBundle(extensionsDir: string, platform: string, arch: string): string[] {
	const archs = expectedIpykernelArchs(platform, arch);
	if (!archs || !fs.existsSync(path.join(extensionsDir, 'positron-python', 'package.json'))) {
		return [];
	}

	const bundleDir = path.join(extensionsDir, IPYKERNEL_BUNDLE_DIR);
	const problems: string[] = [];
	const requireFile = (relativePath: string) => {
		if (!fs.existsSync(path.join(bundleDir, relativePath))) {
			problems.push(`${relativePath} is missing`);
		}
	};

	requireFile(`py3/${PY3_MARKER}`);

	// On macOS, pyzmq publishes only universal2 wheels, so one folder serves both
	// architectures.
	const cpxParents = platform === 'darwin' ? ['universal2'] : archs;
	for (const archDir of archs) {
		for (const marker of CP3_MARKERS) {
			requireFile(`${archDir}/cp3/${marker}`);
		}
	}
	for (const cpxParent of cpxParents) {
		for (const cpxDir of IPYKERNEL_CPX_DIRS) {
			requireFile(`${cpxParent}/${cpxDir}/${CPX_MARKER}`);
		}
	}

	const expectedDirs = new Set(['py3', ...archs, ...cpxParents]);
	const shippedDirs = fs.existsSync(bundleDir)
		? fs.readdirSync(bundleDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
		: [];
	for (const dir of shippedDirs) {
		if (!expectedDirs.has(dir)) {
			problems.push(`${dir}/ does not match the ${platform}-${arch} target`);
		}
	}

	return problems;
}
