/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import * as fs from 'fs';
import * as path from 'path';

test.use({
	suiteId: __filename
});

// Extensions allowed to be absent rather than stalling the wait below. pyrefly
// is blocked from installing by settingsSkipPyrefly.json unless ALLOW_PYREFLY is
// set, so outside a pyrefly-enabled run it can never appear. When it is enabled
// this set is empty, which is what lets the nightly check detect pyrefly drift
// the same way it detects every other bootstrap extension.
const OPTIONAL_MISSING_EXTENSIONS = new Set<string>(
	process.env.ALLOW_PYREFLY === 'true' ? [] : ['meta.pyrefly']
);


test.describe('Bootstrap Extensions', {
	tag: [tags.EXTENSIONS, tags.WEB, tags.WIN, tags.WORKBENCH, tags.CROSS_BROWSER, tags.JUPYTER],
}, () => {

	test.beforeAll('Skip during main run', async function () {
		if (process.env.SKIP_BOOTSTRAP === 'true') {
			test.skip();
		}
	});

	test('Verify All Bootstrap extensions are installed', async function ({ options, runDockerCommand }, testInfo) {
		// Installing every bootstrap extension (pyrefly alone is ~14 MB) does not
		// reliably fit the default 2 minute budget alongside the two grace periods
		// below, and this check is not measuring latency.
		test.slow();

		const extensions = readProductJson();
		const projectName = testInfo.project.name;
		const isDockerProject = projectName === 'e2e-workbench' || projectName === 'e2e-jupyter';

		// Determine container name and user path based on project
		const containerName = projectName === 'e2e-jupyter' ? 'jupyter-test' : 'test';
		const userName = projectName === 'e2e-jupyter' ? 'jupyter-admin' : 'user1';
		const containerExtensionsPath = `/home/${userName}/.positron-server/extensions`;

		await waitForExtensions(
			extensions,
			isDockerProject ? containerExtensionsPath : options.extensionsPath!,
			isDockerProject ? runDockerCommand : undefined,
			containerName
		);
	});
});


function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function readProductJson(): { fullName: string; shortName: string; version: string }[] {
	const raw = fs.readFileSync('product.json', 'utf-8');
	const data = JSON.parse(raw);
	return data.bootstrapExtensions.map((ext: any) => {
		const fullName: string = ext.name;
		const shortName = fullName.split('.').pop()!;
		return {
			fullName,
			shortName,
			version: ext.version
		};
	});
}

async function getInstalledExtensions(extensionsDir: string, runDockerCommand?: (command: string, description: string) => Promise<{ stdout: string; stderr: string }>, containerName?: string): Promise<Map<string, string>> {
	const installed = new Map<string, string>();

	// Docker projects (Workbench/Jupyter): read extensions from Docker container
	if (runDockerCommand && containerName) {
		try {
			const { stdout } = await runDockerCommand(`docker exec ${containerName} bash -lc "ls -1 ${extensionsDir} || true"`, 'List extensions in container');
			const dirs = stdout.split('\n').map(s => s.trim()).filter(Boolean);
			for (const extDir of dirs) {
				try {
					const remotePkgPath = `${extensionsDir}/${extDir}/package.json`;
					const { stdout: pkgStr } = await runDockerCommand(`docker exec ${containerName} cat "${remotePkgPath}"`, `Read package.json for ${extDir}`);
					const pkg = JSON.parse(pkgStr);
					if (pkg.name && pkg.version) {
						installed.set(pkg.name, pkg.version);
					}
				} catch {
					// ignore dirs without package.json or unreadable files
				}
			}
		} catch {
			// If listing fails, treat as no installed extensions
		}
		return installed;
	}

	// Default: read from local filesystem
	if (!fs.existsSync(extensionsDir)) { return installed; }
	for (const extDir of fs.readdirSync(extensionsDir)) {
		const packageJsonPath = path.join(extensionsDir, extDir, 'package.json');
		if (fs.existsSync(packageJsonPath)) {
			const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			if (pkg.name && pkg.version) {
				installed.set(pkg.name, pkg.version);
			}
		}
	}
	return installed;
}

/**
 * Surface the mismatched list to CI so the nightly workflow bumps only the
 * affected extensions instead of every entry in product.json. Called on every
 * path that ends the wait, so partial drift is never dropped on the floor.
 */
function recordMismatches(mismatched: Set<string>) {
	if (!process.env.GITHUB_ACTIONS || mismatched.size === 0) {
		return;
	}
	const outDir = 'test-logs';
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(
		path.join(outDir, 'mismatched-extensions.txt'),
		Array.from(mismatched).join(' ')
	);
}

async function waitForExtensions(
	extensions: { fullName: string; shortName: string; version: string }[],
	extensionsPath: string,
	runDockerCommand?: (command: string, description: string) => Promise<{ stdout: string; stderr: string }>,
	containerName?: string,
	mismatchGraceMs: number = 60_000, // wait up to 1 minute for mismatches to self-resolve
	// Sized against the test.slow() budget (6 minutes), not against a typical
	// run, which resolves on the first poll. The Workbench and Jupyter projects
	// poll through one `docker exec` per extension per iteration, so a bound
	// tight enough for Electron would turn a slow container into a failure.
	installGraceMs: number = 240_000
) {
	const missing = new Set(extensions.map(ext => ext.fullName));
	const mismatched = new Set<string>();

	// Phase 1: wait for all to be installed (mismatches are noted, but we continue).
	// Bounded so an extension that never installs fails with the list below rather
	// than spinning until the test timeout reports only that the test was slow.
	const installDeadline = Date.now() + installGraceMs;
	while (missing.size > 0) {
		const installed = await getInstalledExtensions(extensionsPath, runDockerCommand, containerName);

		for (const ext of extensions) {
			if (!missing.has(ext.fullName)) {
				continue;
			}

			// Prefer fullName (package name) but fall back to shortName
			const installedVersion =
				installed.get(ext.fullName) ??
				installed.get(ext.shortName);

			if (!installedVersion) {
				if (OPTIONAL_MISSING_EXTENSIONS.has(ext.fullName)) {
					console.log(`⚠️ Optional bootstrap extension ${ext.fullName} is not installed; allowing test to continue.`);
					missing.delete(ext.fullName);
				} else {
					console.log(`❌ ${ext.fullName} not yet installed`);
				}
			} else if (installedVersion !== ext.version) {
				console.log(`⚠️  ${ext.fullName} installed with version ${installedVersion}, currently ${ext.version} in product.json`);
				missing.delete(ext.fullName);
				mismatched.add(ext.fullName);
			} else {
				console.log(`✅ ${ext.fullName} (${ext.version}) found and matches`);
				missing.delete(ext.fullName);
			}
		}

		if (missing.size > 0) {
			if (Date.now() >= installDeadline) {
				// Hand over whatever drift we did observe before bailing out, or
				// the nightly loses a real bump PR for the other extensions and
				// posts a bare failure instead.
				recordMismatches(mismatched);
				throw new Error(
					`Bootstrap extensions never installed after ${Math.round(installGraceMs / 1000)}s: ${Array.from(missing).join(', ')}`
				);
			}
			console.log(`⏳ Still waiting on: ${Array.from(missing).join(', ')}`);
			await sleep(1000);
		}
	}

	// Phase 2: give mismatches time to auto-resolve (e.g., post-install updates settling)
	if (mismatched.size > 0) {
		console.log(`\n⏳ Detected mismatches. Allowing up to ${Math.round(mismatchGraceMs / 1000)}s for auto-resolution...`);
		const deadline = Date.now() + mismatchGraceMs;

		while (mismatched.size > 0 && Date.now() < deadline) {
			await sleep(1000);
			const installed = await getInstalledExtensions(extensionsPath, runDockerCommand, containerName);

			for (const extFullName of [...mismatched]) {
				const extMeta = extensions.find(e => e.fullName === extFullName);
				const installedVersion =
					(extMeta && (installed.get(extMeta.fullName) ?? installed.get(extMeta.shortName))) ||
					undefined;
				const expected = extMeta?.version;

				if (installedVersion && expected && installedVersion === expected) {
					console.log(`✅ Resolved: ${extFullName} now matches (${installedVersion})`);
					mismatched.delete(extFullName);
				}
			}
		}
	}

	if (mismatched.size > 0) {
		console.log('\n❌ Some extensions are still mismatched after the grace period:');
		for (const ext of mismatched) {
			console.log(`   * ${ext}`);
		}
		console.log('\n👉 Run script and commit changes:');
		console.log(`   ./scripts/update-extensions.sh ${Array.from(mismatched).join(' ')}\n`);

		recordMismatches(mismatched);

		if (process.env.EXTENSIONS_FAIL_ON_MISMATCH === 'true') {
			throw new Error('Some extensions were installed with mismatched versions (after grace period). Please check the logs above.');
		}
		return; // warn-only mode
	}

	console.log('\n🎉 All extensions installed with correct versions (after waiting for auto-resolution if needed).');
}


