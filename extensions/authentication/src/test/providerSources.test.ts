/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PROVIDER_METADATA } from '../providerSources';

/**
 * Guards against drift between PROVIDER_METADATA in providerSources.ts and the
 * `contributes.authentication` entries in this extension's package.json: adding
 * an auth provider to the manifest without a matching metadata entry is the
 * drift we want to catch.
 */
suite('PROVIDER_METADATA package.json consistency', () => {

	function readPackageJson(...segments: string[]): any {
		const file = path.join(__dirname, '..', '..', ...segments);
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	}

	const authPkg = readPackageJson('package.json');

	test('every authentication contribution has a PROVIDER_METADATA entry', () => {
		// `label` (Accounts menu) and `displayName` are deliberately allowed to
		// differ per provider, so we don't couple them. What we do enforce is
		// that every declared auth provider is known to the metadata.
		const metadataIds = Object.values(PROVIDER_METADATA).map(p => p.id);
		const manifestIds = authPkg.contributes.authentication
			.map((c: { id: string }) => c.id);
		const resolved = manifestIds.filter((id: string) => metadataIds.includes(id));

		assert.deepStrictEqual(resolved, manifestIds);
	});

	test('every PROVIDER_METADATA entry is declared in the manifest', () => {
		// The other direction: metadata for a provider this extension no longer
		// registers would silently report it in diagnostics.
		const manifestIds = authPkg.contributes.authentication
			.map((c: { id: string }) => c.id);
		const orphans = Object.values(PROVIDER_METADATA)
			.map(p => p.id)
			.filter(id => !manifestIds.includes(id));

		assert.deepStrictEqual(orphans, []);
	});

	test('Databricks is catalog-backed', () => {
		assert.deepStrictEqual(PROVIDER_METADATA.databricks, {
			id: 'databricks',
			displayName: 'Databricks',
			catalogId: 'databricks',
		});
	});
});
