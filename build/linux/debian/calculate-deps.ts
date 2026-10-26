/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
// --- Start Positron ---
// import { constants, statSync } from 'fs';
import { constants, statSync, writeFileSync } from 'fs';
// --- End Positron ---
import { tmpdir } from 'os';
import path from 'path';
import manifests from '../../../cgmanifest.json' with { type: 'json' };
import { additionalDeps } from './dep-lists.ts';
import type { DebianArchString } from './types.ts';

export function generatePackageDeps(files: string[], arch: DebianArchString, chromiumSysroot: string, vscodeSysroot: string): Set<string>[] {
	const dependencies: Set<string>[] = files.map(file => calculatePackageDeps(file, arch, chromiumSysroot, vscodeSysroot));
	const additionalDepsSet = new Set(additionalDeps);
	dependencies.push(additionalDepsSet);
	return dependencies;
}

// Based on https://source.chromium.org/chromium/chromium/src/+/main:chrome/installer/linux/debian/calculate_package_deps.py.
function calculatePackageDeps(binaryPath: string, arch: DebianArchString, chromiumSysroot: string, vscodeSysroot: string): Set<string> {
	try {
		if (!(statSync(binaryPath).mode & constants.S_IXUSR)) {
			throw new Error(`Binary ${binaryPath} needs to have an executable bit set.`);
		}
	} catch (e) {
		// The package might not exist. Don't re-throw the error here.
		console.error('Tried to stat ' + binaryPath + ' but failed.');
	}

	// --- Start Positron ---
	// The upstream download runs once per binary, is unauthenticated, and
	// saves HTTP error pages (like a 429 rate limit) as the script. See
	// getDpkgShlibdepsScript() below.
	// // Get the Chromium dpkg-shlibdeps file.
	// const chromiumManifest = manifests.registrations.filter(registration => {
	// 	return registration.component.type === 'git' && registration.component.git!.name === 'chromium';
	// });
	// const dpkgShlibdepsUrl = `https://raw.githubusercontent.com/chromium/chromium/${chromiumManifest[0].version}/third_party/dpkg-shlibdeps/dpkg-shlibdeps.pl`;
	// const dpkgShlibdepsScriptLocation = `${tmpdir()}/dpkg-shlibdeps.pl`;
	// const result = spawnSync('curl', [dpkgShlibdepsUrl, '-o', dpkgShlibdepsScriptLocation]);
	// if (result.status !== 0) {
	// 	throw new Error('Cannot retrieve dpkg-shlibdeps. Stderr:\n' + result.stderr);
	// }
	const dpkgShlibdepsScriptLocation = getDpkgShlibdepsScript();
	// --- End Positron ---
	const cmd = [dpkgShlibdepsScriptLocation, '--ignore-weak-undefined', '--ignore-missing-info'];
	switch (arch) {
		case 'amd64':
			cmd.push(`-l${chromiumSysroot}/usr/lib/x86_64-linux-gnu`,
				`-l${chromiumSysroot}/lib/x86_64-linux-gnu`,
				`-l${vscodeSysroot}/usr/lib/x86_64-linux-gnu`,
				`-l${vscodeSysroot}/lib/x86_64-linux-gnu`);
			break;
		case 'armhf':
			cmd.push(`-l${chromiumSysroot}/usr/lib/arm-linux-gnueabihf`,
				`-l${chromiumSysroot}/lib/arm-linux-gnueabihf`,
				`-l${vscodeSysroot}/usr/lib/arm-linux-gnueabihf`,
				`-l${vscodeSysroot}/lib/arm-linux-gnueabihf`);
			break;
		case 'arm64':
			cmd.push(`-l${chromiumSysroot}/usr/lib/aarch64-linux-gnu`,
				`-l${chromiumSysroot}/lib/aarch64-linux-gnu`,
				`-l${vscodeSysroot}/usr/lib/aarch64-linux-gnu`,
				`-l${vscodeSysroot}/lib/aarch64-linux-gnu`);
			break;
	}
	cmd.push(`-l${chromiumSysroot}/usr/lib`);
	cmd.push(`-l${path.dirname(path.resolve(binaryPath))}`);
	cmd.push(`-L${vscodeSysroot}/debian/libxkbfile1/DEBIAN/shlibs`);
	cmd.push('-O', '-e', path.resolve(binaryPath));

	const dpkgShlibdepsResult = spawnSync('perl', cmd, { cwd: chromiumSysroot });
	if (dpkgShlibdepsResult.status !== 0) {
		throw new Error(`dpkg-shlibdeps failed with exit code ${dpkgShlibdepsResult.status}. stderr:\n${dpkgShlibdepsResult.stderr} `);
	}

	const shlibsDependsPrefix = 'shlibs:Depends=';
	const requiresList = dpkgShlibdepsResult.stdout.toString('utf-8').trimEnd().split('\n');
	let depsStr = '';
	for (const line of requiresList) {
		if (line.startsWith(shlibsDependsPrefix)) {
			depsStr = line.substring(shlibsDependsPrefix.length);
		}
	}
	// Refs https://chromium-review.googlesource.com/c/chromium/src/+/3572926
	// Chromium depends on libgcc_s, is from the package libgcc1.  However, in
	// Bullseye, the package was renamed to libgcc-s1.  To avoid adding a dep
	// on the newer package, this hack skips the dep.  This is safe because
	// libgcc-s1 is a dependency of libc6.  This hack can be removed once
	// support for Debian Buster and Ubuntu Bionic are dropped.
	//
	// --- Start PWB: also exclude libgdk-pixbuf from computed dependencies ---
	// libgdk-pixbuf package has been renamed from libgdk-pixbuf2.0-0 to
	// libgdk-pixbuf-2.0-0 in recent distros. Since we only ship a single
	// linux package we cannot declare a dependency on it. We can safely
	// exclude this dependency as GTK depends on it and we depend on GTK.
	// --- End PWB ---
	//
	// Remove kerberos native module related dependencies as the versions
	// computed from sysroot will not satisfy the minimum supported distros
	// Refs https://github.com/microsoft/vscode/issues/188881.
	// TODO(deepak1556): remove this workaround in favor of computing the
	// versions from build container for native modules.
	const filteredDeps = depsStr.split(', ').filter(dependency => {
		// --- Start PWB: also exclude libgdk-pixbuf (see note above) ---
		return !dependency.startsWith('libgcc-s1') &&
			!dependency.startsWith('libgdk-pixbuf');
		// --- End PWB ---
	}).sort();
	const requires = new Set(filteredDeps);
	return requires;
}

// --- Start Positron ---
// Downloads Chromium's dpkg-shlibdeps script once per build.
let dpkgShlibdepsScriptPath: string | undefined;

/**
 * Returns the path to Chromium's dpkg-shlibdeps script, downloading it on the
 * first call. When GITHUB_TOKEN is set, downloads from the GitHub REST API,
 * which documents a rate limit for that token. Otherwise downloads from
 * raw.githubusercontent.com without authentication.
 */
function getDpkgShlibdepsScript(): string {
	if (dpkgShlibdepsScriptPath) {
		return dpkgShlibdepsScriptPath;
	}

	const chromiumManifest = manifests.registrations.filter(registration => {
		return registration.component.type === 'git' && registration.component.git!.name === 'chromium';
	});
	const chromiumVersion = chromiumManifest[0].version;
	const repoFilePath = 'third_party/dpkg-shlibdeps/dpkg-shlibdeps.pl';
	const dpkgShlibdepsScriptLocation = `${tmpdir()}/dpkg-shlibdeps.pl`;

	// curl reads the headers from stdin so the token stays out of the process
	// list.
	const token = process.env.GITHUB_TOKEN;
	const dpkgShlibdepsUrl = token ?
		`https://api.github.com/repos/chromium/chromium/contents/${repoFilePath}?ref=${chromiumVersion}` :
		`https://raw.githubusercontent.com/chromium/chromium/${chromiumVersion}/${repoFilePath}`;
	const curlConfig = token ?
		`header = "Accept: application/vnd.github.raw"\nheader = "Authorization: Bearer ${token}"\n` :
		'';

	console.log(`Downloading dpkg-shlibdeps from ${dpkgShlibdepsUrl}`);
	// curl prints the response body, then the HTTP status code on its own last
	// line. The script is only written to disk for a 200, so an error page is
	// reported instead of being run by perl.
	const result = spawnSync('curl', ['--silent', '--show-error', '--config', '-', '--write-out', '\n%{http_code}', dpkgShlibdepsUrl], { input: curlConfig });
	if (result.error) {
		throw new Error(`Cannot retrieve dpkg-shlibdeps from ${dpkgShlibdepsUrl}. ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`Cannot retrieve dpkg-shlibdeps from ${dpkgShlibdepsUrl}. curl exited with code ${result.status}: ${result.stderr.toString().trim()}`);
	}
	const statusLineStart = result.stdout.lastIndexOf('\n');
	const body = result.stdout.subarray(0, statusLineStart);
	const httpStatus = result.stdout.subarray(statusLineStart + 1).toString();
	if (httpStatus !== '200') {
		throw new Error(`Cannot retrieve dpkg-shlibdeps from ${dpkgShlibdepsUrl}. HTTP status ${httpStatus}. Response body:\n${body.toString()}`);
	}
	writeFileSync(dpkgShlibdepsScriptLocation, body);
	dpkgShlibdepsScriptPath = dpkgShlibdepsScriptLocation;
	return dpkgShlibdepsScriptPath;
}
// --- End Positron ---
