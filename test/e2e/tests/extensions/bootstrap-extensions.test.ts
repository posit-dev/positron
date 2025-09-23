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
	tag: [tags.EXTENSIONS, tags.WEB, tags.WIN],
}, () => {

	test.beforeAll('Skip during main run', async function () {
		if (process.env.SKIP_BOOTSTRAP === 'true') {
			test.skip();
		}
	});

	test('Verify All Bootstrap extensions are installed', async function ({ options }) {
		const extensions = readProductJson();
		await waitForExtensions(extensions, options.extensionsPath);
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

function getInstalledExtensions(extensionsDir: string): Map<string, string> {
	const installed = new Map<string, string>();
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

async function waitForExtensions(extensions: { fullName: string; shortName: string; version: string }[], extensionsPath: string) {
	const missing = new Set(extensions.map(ext => ext.fullName));
	const mismatched = new Set<string>();

	while (missing.size > 0) {
		const installed = getInstalledExtensions(extensionsPath);

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
		console.log(`   ./scripts/update-extension.sh ${Array.from(mismatched).join(' ')}`);

		if (process.env.EXTENSIONS_FAIL_ON_MISMATCH === 'true') {
			throw new Error('Some extensions were installed with mismatched versions. Please check the logs above.');
		}
	}

	console.log('\n🎉 All extensions installed with correct versions.');
}

