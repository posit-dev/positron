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


test.describe('Bootstrap Extensions', {
	tag: [tags.EXTENSIONS, tags.WEB, tags.WIN, tags.WORKBENCH],
}, () => {

	test.beforeAll('Skip during main run', async function () {
		if (process.env.SKIP_BOOTSTRAP === 'true') {
			test.skip();
		}
	});

	test('Verify All Bootstrap extensions are installed', async function ({ options, runDockerCommand }, testInfo) {
		const extensions = readProductJson();
		const isWorkbench = testInfo.project.name === 'e2e-workbench';
		const containerExtensionsPath = '/home/user1/.positron-server/extensions';
		await waitForExtensions(
			extensions,
			isWorkbench ? containerExtensionsPath : options.extensionsPath!,
			isWorkbench ? runDockerCommand : undefined
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

async function getInstalledExtensions(extensionsDir: string, runDockerCommand?: (command: string, description: string) => Promise<{ stdout: string; stderr: string }>): Promise<Map<string, string>> {
	const installed = new Map<string, string>();

	// Workbench: read extensions from Docker container
	if (runDockerCommand) {
		try {
			const { stdout } = await runDockerCommand(`docker exec test bash -lc "ls -1 ${extensionsDir} || true"`, 'List extensions in container');
			const dirs = stdout.split('\n').map(s => s.trim()).filter(Boolean);
			for (const extDir of dirs) {
				try {
					const remotePkgPath = `${extensionsDir}/${extDir}/package.json`;
					const { stdout: pkgStr } = await runDockerCommand(`docker exec test cat "${remotePkgPath}"`, `Read package.json for ${extDir}`);
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

async function waitForExtensions(
	extensions: { fullName: string; shortName: string; version: string }[],
	extensionsPath: string,
	runDockerCommand?: (command: string, description: string) => Promise<{ stdout: string; stderr: string }>,
	mismatchGraceMs: number = 60_000, // wait up to 1 minute for mismatches to self-resolve
) {
	const missing = new Set(extensions.map(ext => ext.fullName));
	const mismatched = new Set<string>();

	// Phase 1: wait for all to be installed (mismatches are noted, but we continue)
	while (missing.size > 0) {
		const installed = await getInstalledExtensions(extensionsPath, runDockerCommand);

		for (const ext of extensions) {
			if (!missing.has(ext.fullName)) {
				continue;
			}

			const installedVersion = installed.get(ext.shortName);
			if (!installedVersion) {
				console.log(`❌ ${ext.fullName} not yet installed`);
			} else if (installedVersion !== ext.version) {
				console.log(`⚠️ ${ext.fullName} installed with version ${installedVersion}, expected ${ext.version}`);
				missing.delete(ext.fullName);
				mismatched.add(ext.fullName);
			} else {
				console.log(`✅ ${ext.fullName} (${ext.version}) found and matches`);
				missing.delete(ext.fullName);
			}
		}

		if (missing.size > 0) {
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
			const installed = await getInstalledExtensions(extensionsPath, runDockerCommand);

			// Re-evaluate each previously mismatched extension
			for (const ext of [...mismatched]) {
				const installedVersion = installed.get(ext.split('@')[0] /* if your fullName is like 'short@scope' adjust accordingly */)
					?? installed.get(extensions.find(e => e.fullName === ext)?.shortName ?? '');

				// Find the expected version for this ext
				const expected = extensions.find(e => e.fullName === ext)?.version;

				if (installedVersion && expected && installedVersion === expected) {
					console.log(`✅ Resolved: ${ext} now matches (${installedVersion})`);
					mismatched.delete(ext);
				} else {
					// Keep it in the set; optional: log occasionally to avoid spam
				}
			}
		}
	}

	if (mismatched.size > 0) {
		console.log('\n❌ Some extensions are still mismatched after the grace period:');
		for (const ext of mismatched) {
			console.log(`   * ${ext}`);
		}
		console.log('\nRun script and commit changes:');
		console.log(`   ./scripts/update-extensions.sh ${Array.from(mismatched).join(' ')}`);

		if (process.env.EXTENSIONS_FAIL_ON_MISMATCH === 'true') {
			throw new Error('Some extensions were installed with mismatched versions (after grace period). Please check the logs above.');
		}
		return; // warn-only mode
	}

	console.log('\n🎉 All extensions installed with correct versions (after waiting for auto-resolution if needed).');
}


