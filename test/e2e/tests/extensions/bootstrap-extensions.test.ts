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
			isWorkbench ? containerExtensionsPath : options.extensionsPath,
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

async function getInstalledExtensions(extensionsDir?: string, runDockerCommand?: (command: string, description: string) => Promise<{ stdout: string; stderr: string }>): Promise<Map<string, string>> {
	const installed = new Map<string, string>();
	if (!extensionsDir || !fs.existsSync(extensionsDir)) { return installed; }

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

async function waitForExtensions(extensions: { fullName: string; shortName: string; version: string }[], extensionsPath?: string, runDockerCommand?: (command: string, description: string) => Promise<{ stdout: string; stderr: string }>) {
	const missing = new Set(extensions.map(ext => ext.fullName));
	const mismatched = new Set<string>();

	while (missing.size > 0) {
		const installed = await getInstalledExtensions(extensionsPath, runDockerCommand);

		for (const ext of extensions) {
			if (!missing.has(ext.fullName)) { continue; }

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

	if (mismatched.size > 0) {
		console.log('\n❌ Some extensions were installed with mismatched versions:');
		for (const ext of mismatched) {
			console.log(`   * ${ext}`);
		}
		console.log('\nRun script and commit changes:');
		console.log(`   ./scripts/update-extensions.sh ${Array.from(mismatched).join(' ')}`);

		if (process.env.EXTENSIONS_FAIL_ON_MISMATCH === 'true') {
			throw new Error('Some extensions were installed with mismatched versions. Please check the logs above.');
		}
	}

	console.log('\n🎉 All extensions installed with correct versions.');
}

