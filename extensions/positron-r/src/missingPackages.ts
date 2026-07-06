/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { RPackageManager } from './packages';

/**
 * Matches `library(pkg)` / `require(pkg)` with the package given as a bare
 * symbol or a quoted string (`library("pkg")`).
 */
const LIBRARY_REGEX = /\b(?:library|require)\s*\(\s*["']?([A-Za-z][A-Za-z0-9._]*)["']?/g;

/** Matches `requireNamespace("pkg")`, which requires a quoted package name. */
const REQUIRE_NAMESPACE_REGEX = /\brequireNamespace\s*\(\s*["']([A-Za-z][A-Za-z0-9._]*)["']/g;

/** Matches namespace-qualified usage `pkg::fn` and `pkg:::fn`. */
const NAMESPACE_REGEX = /\b([A-Za-z][A-Za-z0-9._]*)\s*:::?\s*[A-Za-z.]/g;

/**
 * Extracts the set of R package names referenced by `library()`, `require()`,
 * `requireNamespace()`, and `pkg::`/`pkg:::` usages in the given source.
 */
export function parseRPackageReferences(code: string): string[] {
	const packages = new Set<string>();
	for (const regex of [LIBRARY_REGEX, REQUIRE_NAMESPACE_REGEX, NAMESPACE_REGEX]) {
		// Reset lastIndex since these are shared module-level /g regexes.
		regex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(code)) !== null) {
			packages.add(match[1]);
		}
	}
	return [...packages];
}

/**
 * Analyzes R code and returns the packages it references that are not installed
 * AND that are available in the session's configured repositories.
 *
 * Installed packages are dropped via the package manager's installed list;
 * remaining references are kept only when the repository search finds an exact
 * match. This is what excludes the GitHub-only / unpublished case: a package
 * that is not on a configured repository is never offered, because we could not
 * install it from a name alone.
 */
export async function listMissingRPackages(
	packageManager: RPackageManager,
	target: positron.RuntimeMissingPackagesTarget,
	token?: vscode.CancellationToken,
): Promise<positron.RuntimeMissingPackage[]> {
	const code = await resolveCode(target);
	if (!code) {
		return [];
	}

	const references = parseRPackageReferences(code);
	if (references.length === 0) {
		return [];
	}

	const installed = new Set((await packageManager.getPackages(token)).map((pkg) => pkg.name));
	const candidates = references.filter((name) => !installed.has(name));

	const result: positron.RuntimeMissingPackage[] = [];
	for (const name of candidates) {
		if (token?.isCancellationRequested) {
			break;
		}
		if (await isAvailable(name, packageManager, token)) {
			result.push({ name });
		}
	}
	return result;
}

/**
 * Returns true when the package repository has a package with exactly this name,
 * i.e. it can be installed. Errors (e.g. a transient network failure) are
 * treated as "not available" so we never offer a package we could not install.
 */
async function isAvailable(
	name: string,
	packageManager: RPackageManager,
	token?: vscode.CancellationToken,
): Promise<boolean> {
	try {
		const matches = await packageManager.searchPackages(name, token);
		return matches.some((pkg) => pkg.name === name);
	} catch {
		return false;
	}
}

/** Reads the code to analyze from the target's inline code or file URI. */
async function resolveCode(target: positron.RuntimeMissingPackagesTarget): Promise<string | undefined> {
	if (target.code !== undefined) {
		return target.code;
	}
	if (target.uri) {
		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.uri));
			return document.getText();
		} catch {
			return undefined;
		}
	}
	return undefined;
}
