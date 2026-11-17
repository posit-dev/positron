/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test, beforeEach, afterEach } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	checkIpykernelBundle,
	expectedIpykernelArchs,
	IPYKERNEL_BUNDLE_DIR,
	IPYKERNEL_CPX_DIRS
} from '../positron-ipykernel-bundle.ts';
import { checkPackagedTree } from '../positron-check-path-lengths.ts';

/** Writes an empty file at each path of `files`, relative to `root`. */
function writeTree(root: string, files: readonly string[]): void {
	for (const relativePath of files) {
		fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
		fs.writeFileSync(path.join(root, relativePath), '');
	}
}

/** The files of a complete architecture folder, for each folder in `archs`. */
function archFiles(archs: readonly string[], cpxParents: readonly string[] = archs): string[] {
	return [
		...archs.flatMap(arch => [`${arch}/cp3/psutil/__init__.py`, `${arch}/cp3/tornado/__init__.py`]),
		...cpxParents.flatMap(parent => IPYKERNEL_CPX_DIRS.map(cpx => `${parent}/${cpx}/zmq/__init__.py`)),
	];
}

/** A packaged `extensions/` directory that ships positron-python with the bundle folders in `bundleFiles`. */
function extensionsTree(bundleFiles: readonly string[]): string[] {
	return [
		'positron-python/package.json',
		`${IPYKERNEL_BUNDLE_DIR}/py3/ipykernel/__init__.py`,
		...bundleFiles.map(file => `${IPYKERNEL_BUNDLE_DIR}/${file}`),
	];
}

suite('positron-ipykernel-bundle', () => {

	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-ipykernel-bundle-'));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('expectedIpykernelArchs names the architecture folders for each build target', () => {
		assert.deepStrictEqual(
			[
				['darwin', 'x64'], ['darwin', 'arm64'],
				['win32', 'x64'], ['win32', 'arm64'],
				['linux', 'x64'], ['linux', 'arm64'],
				['linux', 'armhf'], ['linux', 'alpine'], ['alpine', 'arm64'],
			].map(([platform, arch]) => expectedIpykernelArchs(platform, arch)),
			[
				['x64', 'arm64'], ['x64', 'arm64'],
				['x64'], ['x64', 'arm64'],
				['x64'], ['arm64'],
				undefined, undefined, undefined,
			]);
	});

	suite('checkIpykernelBundle', () => {

		test('passes a complete bundle for each target', () => {
			writeTree(path.join(root, 'win32-x64'), extensionsTree(archFiles(['x64'])));
			writeTree(path.join(root, 'win32-arm64'), extensionsTree(archFiles(['x64', 'arm64'])));
			writeTree(path.join(root, 'darwin'), extensionsTree(archFiles(['x64', 'arm64'], ['universal2'])));
			writeTree(path.join(root, 'linux-arm64'), extensionsTree(archFiles(['arm64'])));

			assert.deepStrictEqual(
				[
					checkIpykernelBundle(path.join(root, 'win32-x64'), 'win32', 'x64'),
					checkIpykernelBundle(path.join(root, 'win32-arm64'), 'win32', 'arm64'),
					checkIpykernelBundle(path.join(root, 'darwin'), 'darwin', 'arm64'),
					checkIpykernelBundle(path.join(root, 'darwin'), 'darwin', 'x64'),
					checkIpykernelBundle(path.join(root, 'linux-arm64'), 'linux', 'arm64'),
				],
				[[], [], [], [], []]);
		});

		test('passes a tree that does not ship positron-python, and a target without a rule', () => {
			writeTree(root, ['positron-r/package.json']);

			assert.deepStrictEqual(checkIpykernelBundle(root, 'win32', 'arm64'), []);
			assert.deepStrictEqual(checkIpykernelBundle(root, 'linux', 'armhf'), []);
		});

		test('fails a Windows arm64 build without the arm64 folder', () => {
			writeTree(root, extensionsTree(archFiles(['x64'])));

			assert.deepStrictEqual(checkIpykernelBundle(root, 'win32', 'arm64'), [
				'arm64/cp3/psutil/__init__.py is missing',
				'arm64/cp3/tornado/__init__.py is missing',
				'arm64/cp310/zmq/__init__.py is missing',
				'arm64/cp311/zmq/__init__.py is missing',
				'arm64/cp312-abi3/zmq/__init__.py is missing',
			]);
		});

		test('fails a Windows x64 build that ships the arm64 folder', () => {
			writeTree(root, extensionsTree(archFiles(['x64', 'arm64'])));

			assert.deepStrictEqual(checkIpykernelBundle(root, 'win32', 'x64'), [
				'arm64/ does not match the win32-x64 target',
			]);
		});

		test('fails a Linux cross-build that bundled the host architecture', () => {
			writeTree(root, extensionsTree(archFiles(['x64'])));

			assert.deepStrictEqual(checkIpykernelBundle(root, 'linux', 'arm64'), [
				'arm64/cp3/psutil/__init__.py is missing',
				'arm64/cp3/tornado/__init__.py is missing',
				'arm64/cp310/zmq/__init__.py is missing',
				'arm64/cp311/zmq/__init__.py is missing',
				'arm64/cp312-abi3/zmq/__init__.py is missing',
				'x64/ does not match the linux-arm64 target',
			]);
		});

		test('fails when a pyzmq install for one Python version was skipped', () => {
			const files = archFiles(['x64', 'arm64'], ['universal2']).filter(file => file !== 'universal2/cp311/zmq/__init__.py');
			writeTree(root, extensionsTree(files));

			assert.deepStrictEqual(checkIpykernelBundle(root, 'darwin', 'arm64'), [
				'universal2/cp311/zmq/__init__.py is missing',
			]);
		});

		test('fails when the pure-Python packages are missing', () => {
			writeTree(root, ['positron-python/package.json', ...archFiles(['x64']).map(file => `${IPYKERNEL_BUNDLE_DIR}/${file}`)]);

			assert.deepStrictEqual(checkIpykernelBundle(root, 'win32', 'x64'), [
				'py3/ipykernel/__init__.py is missing',
			]);
		});
	});

	suite('checkPackagedTree', () => {

		const budgets = { total: 100, default: 100, byExtension: new Map() };

		test('fails the packaged tree when the bundle does not match the target', () => {
			writeTree(path.join(root, 'resources/app/extensions'), extensionsTree(archFiles(['x64'])));

			assert.throws(
				() => checkPackagedTree(root, 'resources/app/extensions', { pathLengths: false, budgets, ipykernelTarget: { platform: 'win32', arch: 'arm64' } }),
				/the ipykernel bundle does not match win32-arm64: arm64\/cp3\/psutil\/__init__.py is missing/);
		});

		test('passes the packaged tree when the bundle matches the target', () => {
			writeTree(path.join(root, 'resources/app/extensions'), extensionsTree(archFiles(['x64'])));

			assert.doesNotThrow(() => checkPackagedTree(root, 'resources/app/extensions', { pathLengths: false, budgets, ipykernelTarget: { platform: 'win32', arch: 'x64' } }));
		});
	});
});
