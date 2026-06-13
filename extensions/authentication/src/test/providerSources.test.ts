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
 * live in the manifests; nothing but this test keeps them in sync.
 *
 * Two manifests are involved:
 *   - this extension's package.json: `contributes.authentication` (id + label)
 *     and the `assistant.provider.<settingName>.enabled` settings for providers
 *     that don't ship via positron-assistant (googleVertex, deepseek).
 *   - positron-assistant's package.json: the `positron.assistant.provider.
 *     <settingName>.enable` settings (and their tags, which `status` mirrors).
 *
 * NOTE: posit-dev/positron#13811 migrates the old `positron.assistant.provider.
 * <name>.enable` keys to the new `assistant.provider.<name>.enabled` format
 * (note the trailing `d`) and moves every enablement setting into a single home.
 * Once that lands, this test simplifies:
 *   - If the settings move here, drop `assistantPkg` and its `collect()` call;
 *     the cross-extension read into positron-assistant goes away (it's being
 *     deprecated anyway). If they move elsewhere, point the single read there.
 *   - Tighten the `provider\.(?<name>[^.]+)\.enabled?$` regex to `\.enabled$`;
 *     the optional `d` only exists to match both the old and new key formats.
 *   - If the migration keeps the old keys around as deprecated aliases instead
 *     of removing them, both keys will exist for the same provider. They map to
 *     the same capture group, so skip anything carrying a `deprecationMessage`/
 *     `markdownDeprecationMessage` to avoid the deprecated entry's tags winning.
 */
suite('PROVIDER_METADATA package.json consistency', () => {

	function readPackageJson(...segments: string[]): any {
		const file = path.join(__dirname, '..', '..', ...segments);
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	}

	const authPkg = readPackageJson('package.json');
	const assistantPkg = readPackageJson('..', 'positron-assistant', 'package.json');

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
		// Collect every `provider.<name>.enable`/`.enabled` setting across both
		// manifests, mapping the name to its maturity status (derived from tags).
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
		collect(assistantPkg);

		const fromMetadata: Record<string, 'preview' | 'experimental' | undefined> = {};
		for (const entry of Object.values(PROVIDER_METADATA)) {
			fromMetadata[entry.settingName] = entry.status;
		}

		assert.deepStrictEqual(fromMetadata, enableSettings);
	});
});
