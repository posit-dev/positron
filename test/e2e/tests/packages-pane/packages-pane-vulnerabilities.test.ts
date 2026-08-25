/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
	extraSettings: {
		'packages.enabled': true,
		// On by default, but stated so the suite doesn't quietly stop testing
		// anything if that default ever changes.
		'packages.vulnerabilities.enabled': true,
	},
});

/**
 * Security advisories in the Packages pane.
 *
 * Both tests install a package whose *installed version* is permanently
 * vulnerable, rather than asserting that something in the interpreter image
 * happens to have an open advisory. The images are rebuilt from
 * test-files/requirements.txt and test-files/DESCRIPTION, so ambient advisories
 * come and go with each rebuild -- as of this writing not one package in
 * DESCRIPTION has an open advisory at its latest version, and the whole CRAN
 * advisory database is 14 records. An "at least one package is flagged" test
 * would go red on a rebuild and read as a product regression.
 *
 * The data comes from a real Package Manager instance (the public one at
 * packagemanager.posit.co unless the environment configures its own), so these
 * tests need network access, same as the installs themselves.
 */
test.describe('Packages Pane - Security Advisories', {
	tag: [tags.PACKAGES_PANE, tags.WEB]
}, () => {

	// Well past the 2 minute default. An install costs up to ~50s (the install
	// helper spends 30s of that waiting out an "Installing packages..." toast that
	// a fast install can clear before it is ever observed) and another ~20s before
	// the new package reaches the list, and only then does the advisory lookup
	// start -- with a budget of its own.
	test.describe.configure({ timeout: 300_000 });

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await app.workbench.packages.clearFilter();
		await app.workbench.packages.closePackagesPane();
		// The Python package manager runs in the terminal, leaving it focused.
		// Click the console label to take focus off the terminal so the next
		// test's console interactions aren't typed into the terminal instead.
		await app.workbench.console.clickConsoleLabel();
	});

	test('Python - Flags an installed package with a known CVE', async function ({ app, python: _python }) {
		const { packages } = app.workbench;

		// bottle 0.12.19 is affected by CVE-2022-31799, fixed in 0.12.20, so the
		// advisory can never age out from under this test. It is a pure-Python
		// wheel with no dependencies and nothing in the image depends on it, so
		// installing and removing it perturbs nothing else.
		await packages.verifyPackagesList();
		await packages.installPackage('bottle', { version: '0.12.19' });
		await packages.expectPackageInList('bottle');

		// Refresh explicitly rather than relying on the refresh the install itself
		// triggers, so the advisory data can't depend on whether the new package
		// had reached the list by the time that refresh ran its metadata stage.
		// This forces a live recompute for every installed package, so the badge
		// can take a while to arrive.
		await packages.clickRefreshPackagesButton();
		await packages.expectVulnerabilityBadge('bottle', {
			advisoryId: 'CVE-2022-31799',
			severity: 'Critical',
		});

		// The Vulnerable filter keeps it.
		await packages.searchPackages('@vulnerable bottle');
		await packages.expectPackageInList('bottle');

		await packages.openPackageDetail('bottle');
		await packages.clickSecurityTab();
		await packages.expectAdvisoryListed('CVE-2022-31799');

		await packages.uninstallPackage('bottle');
		await packages.expectPackageNotInList('bottle');
	});

	test('R - Flags an installed package with an unscored CRAN advisory', async function ({ app, r: _r }) {
		const { packages } = app.workbench;

		// widgetframe is affected by RSEC-2026-0 with no fixed version, so its
		// latest release is vulnerable and no version pin (and no source build) is
		// needed. CRAN advisories carry no CVSS score, so this also covers the
		// unscored rendering: a shield with no number, reported as
		// "Severity unknown" rather than a band.
		await packages.verifyPackagesList();
		await packages.installPackage('widgetframe');
		await packages.expectPackageInList('widgetframe');

		// Same forced refresh as the Python test, to keep both on one path.
		await packages.clickRefreshPackagesButton();
		await packages.expectVulnerabilityBadge('widgetframe', {
			advisoryId: 'RSEC-2026-0',
			severity: 'unscored',
		});

		await packages.openPackageDetail('widgetframe');
		await packages.clickSecurityTab();
		await packages.expectAdvisoryListed('RSEC-2026-0');

		await packages.uninstallPackage('widgetframe');
		await packages.expectPackageNotInList('widgetframe');
	});
});
