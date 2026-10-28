/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as positron from 'positron';
import * as Sinon from 'sinon';
import * as pixi from '../provider-pixi';
import { discoveredStartupBehavior, makeMetadata, rPixiRuntimeDiscoverer, RBinary, RRuntimeSource } from '../provider';
import { PixiMetadata, ReasonDiscovered, RInstallation } from '../r-installation';
import { RRuntimeManager } from '../runtime-manager';

/**
 * Create a minimal R installation in a Pixi environment: the `bin/R` shell
 * wrapper and the utils package DESCRIPTION that `RInstallation` reads.
 *
 * @returns The path to `bin/R`.
 */
function createPixiR(envPath: string, version: string): string {
	const rHome = path.join(envPath, 'lib', 'R');
	const binpath = path.join(envPath, 'bin', 'R');
	fs.mkdirSync(path.dirname(binpath), { recursive: true });
	fs.writeFileSync(binpath, [
		'#!/bin/bash',
		'# Shell wrapper for R executable.',
		`R_HOME_DIR=${rHome}`,
		'if test "${R_HOME_DIR}" = "/unused/lib/R"; then',
		'fi',
		'',
	].join('\n'));
	const utils = path.join(rHome, 'library', 'utils');
	fs.mkdirSync(utils, { recursive: true });
	fs.writeFileSync(path.join(utils, 'DESCRIPTION'),
		`Package: utils\nBuilt: R ${version}; x86_64-pc-linux-gnu; 2024-06-14 22:30:56 UTC; unix\n`);
	return binpath;
}

// Pixi R runtimes are never cached, so a warm discovery cache skips the pass
// that finds them. These cover the Pixi-only scan that registers them anyway.
suite('Pixi R runtimes', () => {
	let root: string;
	let envPath: string;
	let binpath: string;
	let pixiMetadata: PixiMetadata;
	let discoverStub: Sinon.SinonStub;

	suiteSetup(function () {
		// The fake R wrapper is a POSIX shell script.
		if (process.platform === 'win32') {
			this.skip();
		}
	});

	setup(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'r-pixi-'));
		envPath = path.join(root, '.pixi', 'envs', 'default');
		binpath = createPixiR(envPath, '4.4.1');
		pixiMetadata = {
			environmentPath: envPath,
			manifestPath: path.join(root, 'pixi.toml'),
			environmentName: 'default',
		};
		discoverStub = Sinon.stub(pixi, 'discoverPixiBinaries');
	});

	teardown(() => {
		discoverStub.restore();
		fs.rmSync(root, { recursive: true, force: true });
	});

	async function collect(): Promise<positron.LanguageRuntimeMetadata[]> {
		const runtimes: positron.LanguageRuntimeMetadata[] = [];
		for await (const runtime of rPixiRuntimeDiscoverer()) {
			runtimes.push(runtime);
		}
		return runtimes;
	}

	test('yields one non-cacheable runtime per Pixi R binary', async () => {
		const rbin: RBinary = { path: binpath, reasons: [ReasonDiscovered.PIXI], packagerMetadata: pixiMetadata };
		discoverStub.resolves([rbin, { ...rbin }]);

		const runtimes = await collect();

		assert.strictEqual(runtimes.length, 1);
		assert.strictEqual(runtimes[0].runtimeName, 'R 4.4.1 (Pixi: default)');
		assert.strictEqual(runtimes[0].runtimeSource, RRuntimeSource.pixi);
		assert.strictEqual(runtimes[0].cacheable, false);
	});

	test('gives the same runtime ID as full discovery', async () => {
		discoverStub.resolves([{ path: binpath, reasons: [ReasonDiscovered.PIXI], packagerMetadata: pixiMetadata }]);

		const [runtime] = await collect();

		// Full discovery can also find the binary on the PATH and mark it current.
		const fromFullDiscovery = await makeMetadata(
			new RInstallation(binpath, true, [ReasonDiscovered.PATH, ReasonDiscovered.PIXI], pixiMetadata));
		assert.strictEqual(runtime.runtimeId, fromFullDiscovery.runtimeId);
	});

	test('yields runtimes that start when an R file opens', async () => {
		// Pixi Rs are never cached, so unlike other discovered Rs they can
		// start on file open, as the R of the project.
		discoverStub.resolves([{ path: binpath, reasons: [ReasonDiscovered.PIXI], packagerMetadata: pixiMetadata }]);

		const [runtime] = await collect();

		assert.strictEqual(runtime.startupBehavior, positron.LanguageRuntimeStartupBehavior.Implicit);
	});

	test('full discovery gives a Pixi R the same startup behavior', () => {
		// Both searches register the same runtime ID, and the first one
		// registered is kept.
		const fromFullDiscovery = new RInstallation(binpath, true, [ReasonDiscovered.PATH, ReasonDiscovered.PIXI], pixiMetadata);
		// The Pixi reason alone also marks a Pixi R, as for the discovery cache.
		const pixiReasonOnly = new RInstallation(binpath, true, [ReasonDiscovered.PATH, ReasonDiscovered.PIXI]);
		const notPixi = new RInstallation(binpath, true, [ReasonDiscovered.PATH]);

		assert.deepStrictEqual(
			[fromFullDiscovery, pixiReasonOnly, notPixi].map(discoveredStartupBehavior),
			[
				positron.LanguageRuntimeStartupBehavior.Implicit,
				positron.LanguageRuntimeStartupBehavior.Implicit,
				positron.LanguageRuntimeStartupBehavior.Explicit,
			],
		);
	});

	test('skips binaries that are not usable R installations', async () => {
		const notR = path.join(root, 'not-R');
		fs.writeFileSync(notR, '#!/bin/sh\n');
		discoverStub.resolves([{ path: notR, reasons: [ReasonDiscovered.PIXI], packagerMetadata: pixiMetadata }]);

		assert.deepStrictEqual(await collect(), []);
	});

	test('the runtime manager registers each runtime it finds', async () => {
		discoverStub.resolves([{ path: binpath, reasons: [ReasonDiscovered.PIXI], packagerMetadata: pixiMetadata }]);
		// Only `registerLanguageRuntime` is needed, and stubbing it keeps the
		// fake runtime out of Positron.
		const manager = Object.create(RRuntimeManager.prototype) as RRuntimeManager;
		const register = Sinon.stub(manager, 'registerLanguageRuntime');

		await manager.registerPixiRuntimes();

		assert.strictEqual(register.callCount, 1);
		assert.strictEqual(register.firstCall.args[0].runtimePath, binpath);
	});
});
