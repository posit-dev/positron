/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Checks the latest published version of each bootstrap extension in
// product.json for a declared dependency on an extension Positron blocks and
// does not ship as a built-in. Such a version installs but can never activate
// (posit-dev/positron#15118), so we want a heads-up before a nightly bump or a
// user update walks into one. See posit-dev/positron#15124.
//
// Usage:
//   node scripts/check-bootstrap-extension-deps.ts [--json] [--fail-on-hit]
//
//   json:         write the machine-readable report to stdout instead of the
//                 human-readable summary. The nightly workflow consumes this.
//   fail-on-hit:  exit 1 when there is at least one hit. Off by default so a
//                 hit is reported by opening an issue, not by failing the job.
//
// Exit codes: 0 when the check ran (with or without hits), 1 for a hit under
// --fail-on-hit, 2 when the check itself could not run (network, drift, bad
// response).

const fs: typeof import('fs/promises') = require('fs/promises');
const path: typeof import('path') = require('path');
const { readFile, readdir } = fs;
const { join } = path;

// Scripts in this directory are CommonJS (see scripts/package.json) while the
// blocklist is an ES module, so it is pulled in with require(esm). Node strips
// the types on the way through, which is why the specifier keeps its real .ts
// extension: nothing compiles this file to .js first.
const blocklist: typeof import('../src/vs/platform/extensionManagement/common/positronExtensionBlocklist.ts') =
	require('../src/vs/platform/extensionManagement/common/positronExtensionBlocklist.ts');
const { POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN, isUnsatisfiableDependency } = blocklist;

const root = join(__dirname, '..');
// Same endpoint scripts/update-extensions.sh resolves bootstrap versions from.
const P3M_PACKAGES_API = 'https://p3m.dev/__api__/repos/openvsx/packages';

interface IBootstrapExtension {
	readonly name: string;
	readonly version: string;
}

interface IPackageVersion {
	readonly version: string;
	readonly pre_release?: boolean;
	readonly published_at?: string;
}

interface IExtensionManifest {
	readonly extensionDependencies?: string[];
	readonly extensionPack?: string[];
}

interface IHit {
	readonly id: string;
	readonly version: string;
	readonly blockedDependencies: string[];
	readonly blockedPackMembers: string[];
	readonly issueTitle: string;
	readonly issueBody: string;
}

interface IExtensionResult {
	readonly hit?: IHit;
	readonly warnings: string[];
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
	if (!res.ok) {
		throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
	}
	return await res.json() as T;
}

// Every ID in the built-in carve-out list must still name an extension we ship
// in-tree. If one is ever dropped, dependencies on it become unsatisfiable and
// the carve-out is silently wrong, so fail the run instead of under-reporting.
async function assertBuiltinCarveOutIsAccurate(): Promise<void> {
	const inTreeIds = new Set<string>();
	for (const entry of await readdir(join(root, 'extensions'), { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		try {
			const pkg = JSON.parse(await readFile(join(root, 'extensions', entry.name, 'package.json'), 'utf8'));
			if (pkg.publisher && pkg.name) {
				inTreeIds.add(`${pkg.publisher}.${pkg.name}`.toLowerCase());
			}
		} catch {
			// Not an extension directory, or no readable manifest; nothing to record.
		}
	}
	const missing = POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN.filter(id => !inTreeIds.has(id));
	if (missing.length > 0) {
		throw new Error(
			`POSITRON_BLOCKED_EXTENSIONS_WITH_BUILTIN lists IDs with no in-tree extension: ${missing.join(', ')}. ` +
			'Remove them from the carve-out in positronExtensionBlocklist.ts; dependencies on them are no longer satisfiable.');
	}
}

// Picks the version a bootstrap bump would land on: the most recently published
// stable release, falling back to prereleases for an extension that only
// publishes those. Mirrors get_extension_info in scripts/update-extensions.sh.
function selectLatestVersion(versions: IPackageVersion[]): IPackageVersion | undefined {
	const stable = versions.filter(v => v.pre_release !== true);
	const candidates = stable.length > 0 ? stable : versions;
	// A missing or unparsable published_at sorts oldest rather than poisoning the
	// comparator with NaN, which would leave the order arbitrary.
	const publishedAt = (v: IPackageVersion) => Date.parse(v.published_at ?? '') || 0;
	return candidates
		.slice()
		.sort((a, b) => publishedAt(b) - publishedAt(a))[0];
}

function buildIssueBody(id: string, version: string, pinnedVersion: string, blockedDependencies: string[]): string {
	return [
		`The nightly bootstrap extension check found that the latest published version of \`${id}\` declares a dependency that Positron blocks and does not provide as a built-in. An install of this version cannot activate.`,
		'',
		`- Extension: \`${id}\``,
		`- Latest version on the mirror: \`${version}\``,
		`- Version pinned in \`product.json\`: \`${pinnedVersion}\``,
		`- Blocked dependency: ${blockedDependencies.map(d => `\`${d}\``).join(', ')}`,
		'',
		'Do not pin this version in `product.json`. Bootstrap extensions install from a bundled VSIX, which never reaches the gallery-side check added in posit-dev/positron#15474, so a pinned version with an unsatisfiable dependency ships to every user and never activates. Follow up with the extension maintainers, or ship a built-in that satisfies the dependency.',
		'',
		'Opened automatically by the `dependency-check` job in `.github/workflows/extensions-check-nightly.yml`.'
	].join('\n');
}

async function checkExtension(ext: IBootstrapExtension, assetBase: string): Promise<IExtensionResult> {
	const id = ext.name;
	const [publisher, ...rest] = id.split('.');
	const name = rest.join('.');
	const packageInfo = await fetchJson<{ versions?: IPackageVersion[] }>(`${P3M_PACKAGES_API}/${id}`);
	const latest = selectLatestVersion(packageInfo.versions ?? []);
	if (!latest?.version) {
		return { warnings: [`${id}: no published version found on the mirror`] };
	}

	// The manifest is the extension's package.json, served as its own asset, so
	// there is no VSIX to download. It resolves without a targetPlatform query
	// param even for multi-platform extensions.
	const manifest = await fetchJson<IExtensionManifest>(
		`${assetBase}/${publisher}/${name}/${latest.version}/Microsoft.VisualStudio.Code.Manifest`);
	const blockedDependencies = (manifest.extensionDependencies ?? []).filter(isUnsatisfiableDependency);
	const blockedPackMembers = (manifest.extensionPack ?? []).filter(isUnsatisfiableDependency);

	const warnings: string[] = [];
	if (blockedPackMembers.length > 0) {
		// A blocked pack member is skipped at install and the pack still works,
		// so this is informational only.
		warnings.push(`${id} ${latest.version}: extension pack lists blocked extension(s) ${blockedPackMembers.join(', ')} (pack members are skipped at install)`);
	}
	if (blockedDependencies.length === 0) {
		return { warnings };
	}

	return {
		hit: {
			id,
			version: latest.version,
			blockedDependencies,
			blockedPackMembers,
			issueTitle: `Latest ${id} (${latest.version}) depends on blocked extension: ${blockedDependencies.join(', ')}`,
			issueBody: buildIssueBody(id, latest.version, ext.version, blockedDependencies)
		},
		warnings
	};
}

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const product = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
	await assertBuiltinCarveOutIsAccurate();

	// P3M serves assets at {asset_base}/{publisher}/{name}/{version}/{asset},
	// where asset_base is the gallery serviceUrl with "gallery" replaced by
	// "asset". Same derivation as scripts/update-extensions.sh.
	const assetBase: string = product.extensionsGallery.serviceUrl.replace(/\/gallery$/, '/asset');
	const extensions: IBootstrapExtension[] = product.bootstrapExtensions ?? [];
	const hits: IHit[] = [];
	const warnings: string[] = [];
	for (const ext of extensions) {
		const result = await checkExtension(ext, assetBase);
		if (result.hit) {
			hits.push(result.hit);
		}
		warnings.push(...result.warnings);
	}

	const summary = hits.length === 0
		? `Checked ${extensions.length} bootstrap extensions: no blocked dependencies in the latest versions.`
		: `Checked ${extensions.length} bootstrap extensions: ${hits.length} with a blocked dependency in the latest version.`;
	if (args.has('--json')) {
		process.stdout.write(JSON.stringify({ hits, warnings, summary }, null, 2) + '\n');
	} else {
		console.log(summary);
		for (const hit of hits) {
			console.log(`  HIT: ${hit.issueTitle}`);
		}
		for (const warning of warnings) {
			console.log(`  warn: ${warning}`);
		}
	}
	if (hits.length > 0 && args.has('--fail-on-hit')) {
		// Set the code rather than calling process.exit, which would not flush a
		// pending --json write to a pipe.
		process.exitCode = 1;
	}
}

main().catch(err => {
	console.error(`check-bootstrap-extension-deps: ${err.message ?? err}`);
	process.exit(2);
});
