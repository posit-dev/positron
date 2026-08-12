/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as semver from 'semver';
import './mocha-setup';
import {
	archesMismatch,
	assembleItems,
	HealthItem,
	HealthItemId,
	probeDedicatedEnvironment,
	probeDiscovery,
	probeEnvironmentReady,
	probeNoUsableTarget,
	probeRInstalled,
	resolveLibRPath,
	RInstallationLike,
	RInstallationRankable,
	selectTargetInstallation,
} from '../environmentHealth';

suite('environment health: libR path resolution', () => {
	// Mirrors harp::find_r_shared_library_folder. Windows arm64 is deliberately
	// flat; see crates/harp/src/sys/windows/library.rs:107-117.
	const cases: Array<{
		name: string;
		platform: NodeJS.Platform;
		arkArch: 'arm64' | 'x64' | undefined;
		expected: string[];
	}> = [
			{ name: 'macOS', platform: 'darwin', arkArch: 'arm64', expected: ['lib', 'libR.dylib'] },
			{ name: 'Linux', platform: 'linux', arkArch: 'x64', expected: ['lib', 'libR.so'] },
			{ name: 'Windows x64', platform: 'win32', arkArch: 'x64', expected: ['bin', 'x64', 'R.dll'] },
			{ name: 'Windows arm64', platform: 'win32', arkArch: 'arm64', expected: ['bin', 'R.dll'] },
		];

	for (const c of cases) {
		test(`${c.name} resolves the ark-compatible libR path`, () => {
			const rHome = path.join('/opt', 'R', '4.4.1');
			assert.strictEqual(
				resolveLibRPath(rHome, c.platform, c.arkArch),
				path.join(rHome, ...c.expected)
			);
		});
	}

	test('Windows with unknown ark arch falls back to the x64 layout', () => {
		// x64 is the overwhelmingly common Windows R install, so an unknown ark
		// arch should not send us looking in the rarer flat arm64 location.
		const rHome = path.join('C:', 'R', 'R-4.4.1');
		assert.strictEqual(
			resolveLibRPath(rHome, 'win32', undefined),
			path.join(rHome, 'bin', 'x64', 'R.dll')
		);
	});
});

suite('environment health: architecture comparison', () => {
	test('reports a mismatch when R and ark differ', () => {
		assert.strictEqual(archesMismatch('x86_64', 'arm64'), true);
	});

	test('normalizes x64 and x86_64 as the same architecture', () => {
		// The two sniffers use different vocabularies: sniffWindowsBinaryArchitecture
		// returns 'x64', RInstallation.arch records 'x86_64'.
		assert.strictEqual(archesMismatch('x86_64', 'x64'), false);
	});

	test('treats arm64 on both sides as matching', () => {
		assert.strictEqual(archesMismatch('arm64', 'arm64'), false);
	});

	test('reports no mismatch when either side is unknown', () => {
		// A failed sniff is missing information, not evidence of a problem.
		assert.strictEqual(archesMismatch(undefined, 'arm64'), false);
		assert.strictEqual(archesMismatch('arm64', undefined), false);
		assert.strictEqual(archesMismatch('', undefined), false);
	});
});

function installation(over: Partial<RInstallationLike> = {}): RInstallationLike {
	return {
		binpath: '/opt/R/4.4.1/bin/R',
		usable: true,
		supported: true,
		version: '4.4.1',
		reasonRejected: null,
		...over,
	};
}

const READY_OK = {
	usable: true,
	versionSupported: true,
	version: '4.4.1',
	arkFound: true,
	libRPath: '/opt/R/4.4.1/lib/libR.dylib',
	libRExists: true,
	archMismatch: false,
	rArch: 'arm64',
	arkArch: 'arm64' as const,
};

suite('environment health: probeDiscovery', () => {
	test('passes when binaries were found', () => {
		assert.strictEqual(probeDiscovery({ binaryCount: 2 }).status, 'pass');
	});

	test('fails with a diagnostics fix when no binaries were found', () => {
		const item = probeDiscovery({ binaryCount: 0 });
		assert.strictEqual(item.status, 'fail');
		assert.strictEqual(item.fix?.commandId, 'positron.startupDiagnostics.show');
	});

	test('fails and reports the error when discovery threw', () => {
		const item = probeDiscovery({ binaryCount: 0, error: 'boom' });
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('boom'));
		// Both discovery failure modes point at the same docs.
		assert.strictEqual(item.learnMoreUrl, 'https://positron.posit.co/r-installations');
	});
});

suite('environment health: probeRInstalled', () => {
	test('passes when a usable supported install exists', () => {
		assert.strictEqual(probeRInstalled({ installations: [installation()] }).status, 'pass');
	});

	test('fails when every install is unusable, naming the reason', () => {
		const item = probeRInstalled({
			installations: [installation({ usable: false, reasonRejected: 'nonOrthogonal' })],
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('nonOrthogonal'));
	});

	test('fails when the only install is below the minimum version', () => {
		// RInstallation always sets usable=false and reasonRejected='unsupported'
		// for an old R (r-installation.ts:320-340), so this is what real data
		// looks like. The version must still surface, not a generic reason.
		const item = probeRInstalled({
			installations: [installation({
				usable: false, supported: false, version: '4.0.5', reasonRejected: 'unsupported',
			})],
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('4.0.5'));
	});

	test('offers no fix but does link to the discovery docs', () => {
		// There is no install-R command in the repo, unlike python.installPythonViaUv.
		const item = probeRInstalled({ installations: [] });
		assert.strictEqual(item.fix, undefined);
		assert.strictEqual(item.learnMoreUrl, 'https://positron.posit.co/r-installations');
	});
});

suite('environment health: probeEnvironmentReady', () => {
	test('passes when every gate is satisfied', () => {
		assert.strictEqual(probeEnvironmentReady(READY_OK).status, 'pass');
	});

	test('fails when the installation is not usable, reporting the reason', () => {
		const item = probeEnvironmentReady({
			...READY_OK, usable: false, rejectedReason: 'invalid',
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('invalid'));
	});

	test('fails on an unsupported version', () => {
		const item = probeEnvironmentReady({
			...READY_OK, versionSupported: false, version: '4.0.5',
		});
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('4.0.5'));
	});

	test('fails when the ark kernel cannot be located', () => {
		const item = probeEnvironmentReady({ ...READY_OK, arkFound: false });
		assert.strictEqual(item.status, 'fail');
	});

	test('fails when libR is missing, naming the path and R-shlib', () => {
		const item = probeEnvironmentReady({ ...READY_OK, libRExists: false });
		assert.strictEqual(item.status, 'fail');
		assert.ok(item.detail?.includes('/opt/R/4.4.1/lib/libR.dylib'));
		assert.ok(item.detail?.includes('--enable-R-shlib'));
	});

	test('checks ark before libR, because libR resolution needs ark arch', () => {
		const item = probeEnvironmentReady({ ...READY_OK, arkFound: false, libRExists: false });
		assert.ok(!item.detail?.includes('--enable-R-shlib'));
	});

	test('warns without failing on an architecture mismatch', () => {
		const item = probeEnvironmentReady({
			...READY_OK, archMismatch: true, rArch: 'x86_64', arkArch: 'arm64',
		});
		assert.strictEqual(item.status, 'warn');
		assert.ok(item.detail?.includes('x86_64'));
		assert.ok(item.detail?.includes('arm64'));
	});
});

suite('environment health: target selection', () => {
	function rankable(over: Partial<RInstallationRankable> = {}): RInstallationRankable {
		const version = over.semVersion ?? new semver.SemVer('4.4.1');
		return {
			binpath: `/opt/R/${version.format()}/bin/R`,
			usable: true,
			current: false,
			arch: 'x86_64',
			...over,
			semVersion: version,
		};
	}

	test('prefers the installation matching the preferred runtime path', () => {
		const older = rankable({ semVersion: new semver.SemVer('4.2.0') });
		const newer = rankable({ semVersion: new semver.SemVer('4.4.1') });
		assert.strictEqual(selectTargetInstallation([newer, older], older.binpath), older);
	});

	test('falls back to the current installation when nothing is registered yet', () => {
		// The health check can run before startup discovery registers a runtime,
		// which must not be reported as a broken environment.
		const newer = rankable({ semVersion: new semver.SemVer('4.4.1') });
		const current = rankable({ semVersion: new semver.SemVer('4.2.0'), current: true });
		assert.strictEqual(selectTargetInstallation([newer, current], undefined), current);
	});

	test('falls back to the highest version when none is marked current', () => {
		const older = rankable({ semVersion: new semver.SemVer('4.2.0') });
		const newer = rankable({ semVersion: new semver.SemVer('4.4.1') });
		assert.strictEqual(selectTargetInstallation([older, newer], undefined), newer);
	});

	test('falls back when the preferred path matches nothing', () => {
		// A settings change between registry read and discovery leaves a
		// preferred path that is no longer in the discovered list.
		const only = rankable();
		assert.strictEqual(selectTargetInstallation([only], '/nowhere/bin/R'), only);
	});

	test('never falls back to an unusable installation', () => {
		const broken = rankable({ usable: false, current: true });
		assert.strictEqual(selectTargetInstallation([broken], undefined), undefined);
	});

	test('the no-target verdict is a localized fail, not a developer string', () => {
		const item = probeNoUsableTarget();
		assert.strictEqual(item.id, 'environmentReady');
		assert.strictEqual(item.status, 'fail');
		assert.strictEqual(item.summary, 'The R installation is ready to use with Positron');
		assert.ok(!item.detail?.includes('Health check failed'));
		assert.strictEqual(item.fix?.commandId, 'positron.startupDiagnostics.show');
	});
});

suite('environment health: probeDedicatedEnvironment', () => {
	test('passes when the open folder has an renv project', () => {
		const item = probeDedicatedEnvironment({ workspaceFolderPath: '/work/proj', hasRenv: true });
		assert.strictEqual(item.status, 'pass');
	});

	test('fails with the renv fix when the open folder has no renv project', () => {
		const item = probeDedicatedEnvironment({ workspaceFolderPath: '/work/proj', hasRenv: false });
		assert.strictEqual(item.status, 'fail');
		assert.strictEqual(item.fix?.commandId, 'r.renvInit');
		assert.ok(item.detail?.includes('/work/proj'));
	});

	test('warns with the new-folder fix when no folder is open', () => {
		const item = probeDedicatedEnvironment({ hasRenv: false });
		assert.strictEqual(item.status, 'warn');
		assert.strictEqual(item.fix?.commandId, 'positron.workbench.action.newFolderFromTemplate');
	});
});

suite('environment health: assembleItems cascade', () => {
	const pass = (id: HealthItemId): HealthItem => ({ id, status: 'pass', summary: id });
	const fail = (id: HealthItemId): HealthItem => ({ id, status: 'fail', summary: id });
	const warn = (id: HealthItemId): HealthItem => ({ id, status: 'warn', summary: id });

	const allPass = {
		discovery: () => pass('discovery'),
		rInstalled: () => pass('rInstalled'),
		ready: () => pass('environmentReady'),
		dedicated: () => pass('dedicatedEnvironment'),
	};

	test('reports ok with four items when everything passes', async () => {
		const result = await assembleItems(allPass);
		assert.strictEqual(result.ok, true);
		assert.deepStrictEqual(result.items.map((i) => i.id),
			['discovery', 'rInstalled', 'environmentReady', 'dedicatedEnvironment']);
	});

	test('a discovery failure skips the other three', async () => {
		const result = await assembleItems({ ...allPass, discovery: () => fail('discovery') });
		assert.strictEqual(result.ok, false);
		assert.deepStrictEqual(result.items.map((i) => i.status),
			['fail', 'skipped', 'skipped', 'skipped']);
		// A skipped item is still rendered, so its summary must not be the id.
		assert.ok(result.items.slice(1).every((i) => !i.summary.includes(i.id)),
			`skipped summaries leaked an id: ${result.items.slice(1).map((i) => i.summary)}`);
	});

	test('an rInstalled failure skips the last two', async () => {
		const result = await assembleItems({ ...allPass, rInstalled: () => fail('rInstalled') });
		assert.deepStrictEqual(result.items.map((i) => i.status),
			['pass', 'fail', 'skipped', 'skipped']);
	});

	test('an environmentReady failure skips only dedicatedEnvironment', async () => {
		const result = await assembleItems({ ...allPass, ready: () => fail('environmentReady') });
		assert.deepStrictEqual(result.items.map((i) => i.status),
			['pass', 'pass', 'fail', 'skipped']);
	});

	test('a warn does not flip ok and does not short-circuit', async () => {
		const result = await assembleItems({ ...allPass, ready: () => warn('environmentReady') });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.items[3].status, 'pass');
	});

	test('a throwing producer becomes a fail item rather than rejecting', async () => {
		const result = await assembleItems({
			...allPass,
			ready: () => { throw new Error('kaboom'); },
		});
		assert.strictEqual(result.items[2].status, 'fail');
		assert.ok(result.items[2].detail?.includes('kaboom'));
		// The raw error goes in detail; summary stays user-facing, not the id.
		assert.ok(!result.items[2].summary.includes('environmentReady'));
		assert.strictEqual(result.items[3].status, 'skipped');
	});
});
