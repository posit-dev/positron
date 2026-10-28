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
import * as vscode from 'vscode';
import { runtimeManager } from '../extension';
import { currentRInstallation, makeMetadata } from '../provider';
import { RMetadataExtra } from '../r-installation';

// Links to the machine's current R, so these tests need R installed.
suite('R current R check', () => {
	teardown(async () => {
		await vscode.workspace.getConfiguration('positron.r').update('customBinaries', undefined, vscode.ConfigurationTarget.Global);
	});

	// A path from a setting, such as `/usr/local/bin/R` from CRAN's installer, can be a
	// link to the current R. Creating a link needs extra privileges on Windows.
	test('a link to the current R is the current R, when registered from a path or validated', async function () {
		const current = await currentRInstallation();
		if (!current?.usable || process.platform === 'win32') {
			this.skip();
		}
		const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-r-link-'));
		try {
			const link = path.join(linkDir, 'R');
			fs.symlinkSync(current.binpath, link);

			const registered = await runtimeManager.registerRuntimeFromPath(link);
			const saved = await makeMetadata(current);
			const validated = await runtimeManager.validateMetadata({
				...saved,
				extraRuntimeData: { ...saved.extraRuntimeData, binpath: link, current: false },
			});

			// Both have the current R's own path, so the picker lists it once.
			const summary = (metadata: positron.LanguageRuntimeMetadata) =>
				({ current: (metadata.extraRuntimeData as RMetadataExtra).current, runtimePath: metadata.runtimePath });
			assert.deepStrictEqual(
				{ registered: summary(registered), validated: summary(validated) },
				{ registered: { current: true, runtimePath: current.binpath }, validated: { current: true, runtimePath: current.binpath } },
			);
		} finally {
			fs.rmSync(linkDir, { recursive: true, force: true });
		}
	});
});
