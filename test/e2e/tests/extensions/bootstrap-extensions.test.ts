/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

test.use({
	suiteId: __filename
});

const EXT_DIR = path.join(os.tmpdir(), 'vscsmoke', 'extensions-dir');

test.describe('Bootstrap Extensions', {
	tag: [tags.EXTENSIONS, tags.WEB],
}, () => {

	test('Verify All Bootstrap extensions are installed', {
		tag: [tags.EXTENSIONS, tags.WEB]
	}, async function () {

		const extensions = readProductJson();
		await waitForExtensions(extensions);

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

function getInstalledExtensions(): Map<string, string> {
	const installed = new Map<string, string>();
	if (!fs.existsSync(EXT_DIR)) { return installed; }

	for (const extDir of fs.readdirSync(EXT_DIR)) {
		const packageJsonPath = path.join(EXT_DIR, extDir, 'package.json');
		if (fs.existsSync(packageJsonPath)) {
			const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			if (pkg.name && pkg.version) {
				installed.set(pkg.name, pkg.version);
			}
		}
	}

	return installed;
}

async function waitForExtensions(extensions: { fullName: string; shortName: string; version: string }[]) {
	const missing = new Set(extensions.map(ext => ext.fullName));

	while (missing.size > 0) {
		const installed = getInstalledExtensions();

		for (const ext of extensions) {
			if (!missing.has(ext.fullName)) { continue; }

			const installedVersion = installed.get(ext.shortName);
			if (!installedVersion) {
				console.log(`❌ ${ext.fullName} not yet installed`);
			} else if (installedVersion !== ext.version) {
				console.log(`⚠️ ${ext.fullName} installed with version ${installedVersion}, expected ${ext.version}`);
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

	console.log('🎉 All extensions installed with correct versions.');
}

