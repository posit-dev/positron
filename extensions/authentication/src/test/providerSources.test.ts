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
 * package.json contributions that own the same data. The metadata hardcodes
 * provider ids, display names, setting names, and maturity status that really
 * live in this extension's manifest; nothing but this test keeps them in sync.
 *
 * Two sets of contributions in this extension's package.json are involved:
 *   - `contributes.authentication` (id + label).
 *   - the provider enablement settings (and their tags, which `status`
 *     mirrors). posit-dev/positron#13811 already moved every enablement
 *     setting into this manifest (the old positron-assistant home is gone) and
 *     is still renaming the legacy `positron.assistant.provider.<name>.enable`
 *     keys to the new `assistant.provider.<name>.enabled` format (note the
 *     trailing `d`). Until every key is renamed, both formats coexist here.
 *
 * The `provider\.(?<name>[^.]+)\.enabled?$` regex matches both formats; the
 * optional `d` only exists to bridge them. Tighten it to `\.enabled$` once the
 * rename is complete. If any legacy key is kept around as a deprecated alias
 * (so both keys exist for one provider, mapping to the same capture group),
 * skip entries carrying a `deprecationMessage`/`markdownDeprecationMessage` so
 * the deprecated entry's tags don't win.
 */
suite('PROVIDER_METADATA package.json consistency', () => {

	function readPackageJson(...segments: string[]): any {
		const file = path.join(__dirname, '..', '..', ...segments);
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	}

	const authPkg = readPackageJson('package.json');

	test('every authentication contribution has a PROVIDER_METADATA entry', () => {
		// `label` (Accounts menu) and `displayName` (model picker) are deliberately
		// allowed to differ per provider, so we don't couple them. What we do
		// enforce is that every declared auth provider is known to the metadata:
		// adding a contribution to package.json without a matching entry here is
		// the drift we want to catch. Providers without a contribution (e.g.
		// copilot, which rides GitHub's auth) aren't required to appear.
		const metadataIds = Object.values(PROVIDER_METADATA).map(p => p.id);
		const manifestIds = authPkg.contributes.authentication.map((c: { id: string }) => c.id);
		const resolved = manifestIds.filter((id: string) => metadataIds.includes(id));

		assert.deepStrictEqual(resolved, manifestIds);
	});

	test('settingName and status match the provider enable settings', () => {
		// Collect every `provider.<name>.enable`/`.enabled` setting in the
		// manifest, mapping the name to its maturity status (derived from tags).
		// `status` in PROVIDER_METADATA must mirror that exactly.
		const enableSettings: Record<string, 'preview' | 'experimental' | undefined> = {};
		const collect = (pkg: any) => {
			const properties = pkg.contributes?.configuration;
			const sections = Array.isArray(properties) ? properties : [properties];
			for (const section of sections) {
				for (const [key, value] of Object.entries<any>(section?.properties ?? {})) {
					const match = /provider\.(?<name>[^.]+)\.enabled?$/.exec(key);
					if (match?.groups) {
						const tags: string[] = value.tags ?? [];
						enableSettings[match.groups.name] = tags.includes('experimental')
							? 'experimental'
							: tags.includes('preview') ? 'preview' : undefined;
					}
				}
			}
		};
		collect(authPkg);

		const fromMetadata: Record<string, 'preview' | 'experimental' | undefined> = {};
		for (const entry of Object.values(PROVIDER_METADATA)) {
			fromMetadata[entry.settingName] = entry.status;
		}

		assert.deepStrictEqual(fromMetadata, enableSettings);
	});
});
