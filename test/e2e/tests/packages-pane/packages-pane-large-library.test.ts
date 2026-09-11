/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test as base, tags } from '../_test.setup';

/**
 * Packages pane with a large library (posit-dev/positron#12994).
 *
 * Rather than installing thousands of real packages, each test generates a
 * synthetic library on disk and puts it on the session's package search path:
 * both kernels discover packages from the filesystem, so everything downstream
 * of the fixture -- kernel enumeration, the comm, the packages service, the
 * virtualized pane -- is the real product code under a real 1,500-package load.
 *
 * - Python lists via `importlib.metadata.distributions()` (see ui.py), which
 *   walks `sys.path`: a directory of minimal `*.dist-info` folders prepended to
 *   `sys.path` reads as 1,500 installed distributions.
 * - R lists via ark's `pkg_list` over `.libPaths()`: a library of stub packages
 *   (DESCRIPTION plus a Meta/package.rds cloned from a real base package and
 *   patched, so whatever fields the lister reads are present) prepended with
 *   `.libPaths()` reads as 1,500 installed packages.
 *
 * The fixtures live only in this session's search path and a temp dir removed
 * in afterAll, so nothing leaks into the machine's interpreters.
 */

const PACKAGE_COUNT = 1500;
// pyfakepkg0000 .. / rfakepkg0000 ..; the names are prefixed per language so an
// assertion can only be satisfied by its own session's library, and the *last*
// one proves the full set traversed kernel -> comm -> service -> pane.
const LAST_PY_PACKAGE = `pyfakepkg${String(PACKAGE_COUNT - 1).padStart(4, '0')}`;
const LAST_R_PACKAGE = `rfakepkg${String(PACKAGE_COUNT - 1).padStart(4, '0')}`;
// Printed by both generator scripts; the tests wait for it in the console
// before refreshing the pane. executeCode can return before the submitted code
// has started running (its ready-prompt check races the code submission), and a
// refresh issued in that window lists the library as it was *before* the
// fixtures existed.
const READY_MARKER = 'biglib-ready';

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({ 'packages.enabled': true });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

/** Writes the generator scripts for both languages; returns their paths. */
function writeGeneratorScripts(fixtureDir: string): { pyScript: string; rScript: string } {
	// Forward slashes work for both languages on every platform and avoid
	// escaping trouble on Windows.
	const dir = fixtureDir.replace(/\\/g, '/');

	const pyScript = path.join(fixtureDir, 'generate-py-lib.py');
	fs.writeFileSync(pyScript, [
		'import os, sys',
		`root = os.path.join("${dir}", "py-lib")`,
		'os.makedirs(root, exist_ok=True)',
		`for i in range(${PACKAGE_COUNT}):`,
		'    name = "pyfakepkg%04d" % i',
		'    d = os.path.join(root, "%s-1.0.0.dist-info" % name)',
		'    os.makedirs(d, exist_ok=True)',
		'    with open(os.path.join(d, "METADATA"), "w") as f:',
		'        f.write("Metadata-Version: 2.1\\nName: %s\\nVersion: 1.0.0\\nSummary: Synthetic package for Positron e2e tests\\n" % name)',
		'    with open(os.path.join(d, "RECORD"), "w") as f:',
		'        pass',
		'sys.path.insert(0, root)',
		`print("${READY_MARKER}")`,
		'',
	].join('\n'));

	const rScript = path.join(fixtureDir, 'generate-r-lib.R');
	fs.writeFileSync(rScript, [
		`root <- file.path("${dir}", "r-lib")`,
		'dir.create(root, recursive = TRUE, showWarnings = FALSE)',
		'# Clone a real installed package\'s Meta so every field the lister reads is present.',
		'meta <- readRDS(file.path(find.package("stats"), "Meta", "package.rds"))',
		`for (i in seq_len(${PACKAGE_COUNT}) - 1L) {`,
		'  name <- sprintf("rfakepkg%04d", i)',
		'  meta_dir <- file.path(root, name, "Meta")',
		'  dir.create(meta_dir, recursive = TRUE, showWarnings = FALSE)',
		'  desc <- c(Package = name, Version = "1.0.0",',
		'            Title = "Synthetic package for Positron e2e tests",',
		'            Description = "Generated fixture for positron issue 12994.",',
		'            License = "MIT",',
		'            Built = paste0("R ", getRversion(), "; ; ", format(Sys.time(), "%Y-%m-%d %H:%M:%S UTC"), "; unix"))',
		'  writeLines(paste0(names(desc), ": ", desc), file.path(root, name, "DESCRIPTION"))',
		'  pkg_meta <- meta',
		'  pkg_meta$DESCRIPTION <- desc',
		'  saveRDS(pkg_meta, file.path(meta_dir, "package.rds"))',
		'}',
		'.libPaths(c(root, .libPaths()))',
		`cat("${READY_MARKER}\\n")`,
		'',
	].join('\n'));

	return { pyScript, rScript };
}

test.describe('Packages Pane - Large Library', {
	tag: [tags.PACKAGES_PANE, tags.WEB]
}, () => {

	let fixtureDir: string;
	let pyScript: string;
	let rScript: string;

	test.beforeAll(async () => {
		fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-e2e-biglib-'));
		({ pyScript, rScript } = writeGeneratorScripts(fixtureDir));
	});

	test.afterAll(async () => {
		fs.rmSync(fixtureDir, { recursive: true, force: true });
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.packages.clearFilter();
		await app.workbench.packages.closePackagesPane();
	});

	test('Python - Packages pane loads and filters a 1,500-package library',
		async function ({ app, python: _python, executeCode }) {
			const { console, packages } = app.workbench;

			await executeCode('Python', `exec(open(${JSON.stringify(pyScript.replace(/\\/g, '/'))}).read())`);
			// Only the generator's own output proves the fixtures exist; see READY_MARKER.
			await console.waitForConsoleContents(READY_MARKER);

			await packages.verifyPackagesList();
			await packages.clickRefreshPackagesButton();

			// The last synthetic package is reachable through the filter: the whole
			// set made it from the kernel to the (virtualized) pane.
			await packages.searchPackages(LAST_PY_PACKAGE);
			await packages.expectPackageInList(LAST_PY_PACKAGE);

			// And clearing the filter re-renders the full library.
			await packages.clearFilter();
			await packages.expectPackagesListPopulated();
		});

	test('R - Packages pane loads and filters a 1,500-package library',
		async function ({ app, r: _r, executeCode }) {
			const { console, packages } = app.workbench;

			await executeCode('R', `source(${JSON.stringify(rScript.replace(/\\/g, '/'))})`);
			// Only the generator's own output proves the fixtures exist; see READY_MARKER.
			await console.waitForConsoleContents(READY_MARKER);

			await packages.verifyPackagesList();
			await packages.clickRefreshPackagesButton();

			await packages.searchPackages(LAST_R_PACKAGE);
			await packages.expectPackageInList(LAST_R_PACKAGE);

			await packages.clearFilter();
			await packages.expectPackagesListPopulated();
		});
});
