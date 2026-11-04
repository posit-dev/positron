/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Asks the PPM gallery, the endpoint Positron itself installs from, which
// version each bootstrap extension in product.json can be bumped to: the
// newest stable version whose VS Code and Positron engine ranges this Positron
// satisfies and that has a build for every platform Positron ships. A newer
// version missing a platform is skipped (meta.pyrefly 1.3.2 shipped without a
// win32-x64 build), and held back when nothing complete is newer than the
// pin. See posit-dev/positron#16338.
//
// Usage:
//   node scripts/check-bootstrap-extension-versions.ts [--json]
//
//   json:  write the machine-readable report to stdout instead of the
//          human-readable summary. The nightly workflow consumes this.
//
// Exit codes: 0 when the check ran, 2 when it could not run (product.json
// unreadable, or no extension could be queried at all). One extension that
// cannot be queried is a warning, not a failure.

const fs: typeof import('fs/promises') = require('fs/promises');
const path: typeof import('path') = require('path');
const { readFile } = fs;
const { join } = path;

// Scripts in this directory are CommonJS (see scripts/package.json) while the
// shared module is an ES module, so it is pulled in with require(esm). Node
// strips the types on the way through, which is why the specifier keeps its
// real .ts extension: nothing compiles this file to .js first.
const shared: typeof import('../src/vs/platform/extensionManagement/common/positronBootstrapExtensionVersions.ts') =
	require('../src/vs/platform/extensionManagement/common/positronBootstrapExtensionVersions.ts');
const { checkBootstrapExtensionVersion } = shared;

type IGalleryVersion = import('../src/vs/platform/extensionManagement/common/positronBootstrapExtensionVersions.ts').IGalleryVersion;
type IBootstrapVersionResult = import('../src/vs/platform/extensionManagement/common/positronBootstrapExtensionVersions.ts').IBootstrapVersionResult;

const root = join(__dirname, '..');

// extensionquery request constants, from extensionGalleryService.ts: filter
// on the extension name and the VS Code target, and ask for all versions with
// their properties (engine range, pre-release flag) and target platforms.
const FILTER_TYPE_EXTENSION_NAME = 7;
const FILTER_TYPE_TARGET = 8;
const FLAGS_INCLUDE_VERSIONS = 0x1;
const FLAGS_INCLUDE_VERSION_PROPERTIES = 0x10;
const FLAGS_EXCLUDE_NON_VALIDATED = 0x20;

interface IBootstrapExtension {
	readonly name: string;
	readonly version: string;
}

interface IGalleryQueryResponse {
	readonly results?: { readonly extensions?: { readonly versions?: IGalleryVersion[] }[] }[];
}

async function queryGallery(serviceUrl: string, id: string): Promise<IGalleryVersion[] | undefined> {
	const url = `${serviceUrl}/extensionquery`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json;api-version=3.0-preview.1'
		},
		body: JSON.stringify({
			filters: [{
				criteria: [
					{ filterType: FILTER_TYPE_EXTENSION_NAME, value: id },
					{ filterType: FILTER_TYPE_TARGET, value: 'Microsoft.VisualStudio.Code' }
				],
				pageNumber: 1,
				pageSize: 1
			}],
			flags: FLAGS_INCLUDE_VERSIONS | FLAGS_INCLUDE_VERSION_PROPERTIES | FLAGS_EXCLUDE_NON_VALIDATED
		})
	});
	if (!res.ok) {
		throw new Error(`POST ${url} -> ${res.status} ${res.statusText}`);
	}
	const body = await res.json() as IGalleryQueryResponse;
	return body.results?.[0]?.extensions?.[0]?.versions;
}

function formatResult(result: IBootstrapVersionResult): string {
	const decision = result.decision.padEnd(7);
	switch (result.decision) {
		case 'current':
			return `  ${decision} ${result.id} ${result.pinned}`;
		case 'bump':
			return `  ${decision} ${result.id} ${result.pinned} -> ${result.latest}`;
		case 'hold':
			return `  ${decision} ${result.id} ${result.pinned} -> ${result.latest}: ${result.reason}`;
	}
}

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const product = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
	const engines = {
		// The VS Code version Positron reports to extensions, matched against
		// their engines.vscode range.
		vscode: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version as string,
		positron: product.positronVersion as string
	};
	const serviceUrl: string = product.extensionsGallery.serviceUrl;
	const extensions: IBootstrapExtension[] = product.bootstrapExtensions ?? [];

	const results: IBootstrapVersionResult[] = [];
	const warnings: string[] = [];
	for (const ext of extensions) {
		let versions: IGalleryVersion[] | undefined;
		try {
			versions = await queryGallery(serviceUrl, ext.name);
		} catch (err) {
			warnings.push(`${ext.name}: gallery query failed: ${err instanceof Error ? err.message : err}`);
			continue;
		}
		if (!versions) {
			warnings.push(`${ext.name}: not found on the gallery`);
			continue;
		}
		const check = checkBootstrapExtensionVersion(ext.name, ext.version, versions, engines);
		results.push(check.result);
		warnings.push(...check.warnings);
	}
	if (extensions.length > 0 && results.length === 0) {
		throw new Error(`no bootstrap extension could be checked\n  ${warnings.join('\n  ')}`);
	}

	const count = (decision: IBootstrapVersionResult['decision']) => results.filter(r => r.decision === decision).length;
	const checked = results.length === extensions.length
		? `Checked ${extensions.length} bootstrap extensions`
		: `Checked ${results.length} of ${extensions.length} bootstrap extensions`;
	const summary = `${checked}: ${count('bump')} to bump, ${count('hold')} held back, ${count('current')} current.`;
	if (args.has('--json')) {
		process.stdout.write(JSON.stringify({ summary, results, warnings }, null, 2) + '\n');
	} else {
		console.log(summary);
		for (const result of results) {
			console.log(formatResult(result));
		}
		for (const warning of warnings) {
			console.log(`  warn: ${warning}`);
		}
	}
}

main().catch(err => {
	console.error(`check-bootstrap-extension-versions: ${err.message ?? err}`);
	process.exit(2);
});
