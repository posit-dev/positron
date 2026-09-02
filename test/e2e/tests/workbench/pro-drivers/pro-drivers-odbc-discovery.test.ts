/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Verifies that Posit Pro Drivers installed on the Workbench host surface in the Data Connections
 * pane as detected connections, and that one can be browsed down to real rows.
 *
 * The suite installs the drivers itself and removes them again on teardown, rather than relying on
 * the image or the wb-local install scripts to provide them. That keeps the feature isolated: every
 * other suite in the Workbench lane shares this container, and a machine-wide ODBC configuration is
 * exactly the kind of state that would otherwise leak into them (the pane lists discovered DSNs for
 * any suite that opens it). The cost is the install itself, roughly 40s against the Posit repo.
 *
 * The install is the documented one:
 *   https://docs.posit.co/data-sources/admin/pro-drivers/installation.html
 *
 * Three things about it are easy to get wrong, and all three are load-bearing here:
 *
 *   1. The `rstudio-drivers` package does NOT write `/etc/odbcinst.ini`. It ships a preconfigured
 *      `odbcinst.ini.sample` and leaves installing it to the admin, so without that step the drivers
 *      are on disk but no driver is registered and nothing is discovered.
 *
 *   2. That sample REPLACES `/etc/odbcinst.ini` rather than being appended to it. Appending happens
 *      to work on Ubuntu, where the file is empty, but Rocky's unixODBC ships a file that already
 *      defines `[PostgreSQL]` (pointing at the distro's `psqlodbcw.so`, which is not installed).
 *      Appending there leaves two stanzas of that name; unixODBC takes the first, so the DSNs would
 *      resolve to the distro driver and fail to connect. Hence back up, replace, and restore.
 *
 *   3. Removing the package does NOT restore `/etc/odbcinst.ini` -- no package owns that file, so a
 *      purge leaves every stanza behind pointing at deleted `.so` files. Teardown restores the
 *      backup explicitly.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, tags, expect } from '../../_test.setup';

test.use({
	suiteId: __filename,
	// The Data Connections panel is a preview feature gated behind `dataConnections.enabled`. This
	// bakes the setting into the Workbench container at startup, which reads settings copied in at
	// launch rather than the host settings file written at runtime.
	enableDataConnections: true,
});

// The Workbench host container from docker/environments/wb-local.
const CONTAINER = 'test';

// Where the Pro Drivers land, and the unixODBC files that make them usable. `/etc` is the config
// directory the ODBC driver extension reads and watches on Linux (see `SYSTEM_CONFIG_DIRS` in
// extensions/positron-data-driver-odbc/src/odbcinst.ts).
const DRIVERS_DIR = '/opt/rstudio-drivers';
const POSTGRES_DRIVER_SO = `${DRIVERS_DIR}/postgresql/bin/lib/libpostgresqlodbc_sb64.so`;
const ODBCINST_PATH = '/etc/odbcinst.ini';
const ODBCINI_PATH = '/etc/odbc.ini';

// Suffix for the backups of the two config files, restored on teardown. Named for the suite so a
// stray backup is traceable to what left it behind.
const BACKUP_SUFFIX = '.pro-drivers-test.bak';

// The compose Postgres. The password comes from E2E_POSTGRES_PASSWORD (the project's .env file
// locally, 1Password in CI), matching tests/data-connections/postgres.test.ts.
const PG_HOST = 'postgres';
const PG_PORT = '5432';
const PG_USER = 'e2e';
const PG_PASSWORD = process.env.E2E_POSTGRES_PASSWORD || 'testpassword';

// DSN names are test-scoped rather than the bare database names. The Workbench lane also runs
// tests/data-connections/postgres.test.ts, which saves a connection named `dvdrental`; a discovered
// row sharing that name would make the connection-entry locators match two rows.
const PERIODIC_DSN = 'e2e_periodic';
const DVDRENTAL_DSN = 'e2e_dvdrental';

// The `elements` table in the `periodic` sample database, loaded by the Postgres image's init
// script (docker/images/postgres/init-scripts/10-init-databases.sh). Ten rows, ordered by
// atomic_number, so the first row is stable to assert against.
const ELEMENTS_COLUMNS = ['atomic_number', 'symbol', 'name'];
const ELEMENTS_FIRST_ROW = ['1', 'H', 'Hydrogen'];

/**
 * The three host OSes the Workbench lane runs on: Ubuntu 24 by default, Rocky 9 when the
 * `@:workbench-rocky` job selects it, and openSUSE Leap 15.6 for `@:workbench-suse`. All three run
 * the same `@:workbench` test set, so this suite has to work on any of them.
 *
 * Keyed by package manager rather than package format, because the two rpm hosts share a format and
 * a setup script but not a manager: Rocky installs with `dnf`, openSUSE with `zypper`.
 */
type PackageManager = 'apt' | 'dnf' | 'zypper';

/**
 * zypper has to run with the system bin directories ahead of `/opt/conda/bin`, which the openSUSE
 * image puts first on PATH. zypper shells out to `repo2solv` by name, and conda ships its own
 * libsolv whose `repo2solv` lacks rpm-md support, so conda's shadows the system one and every
 * refresh fails with "rpmmd repo type is not supported" -- leaving zypper with no package names and
 * an install that reports `rstudio-drivers` "not found in package names". Same fix and same reason
 * as `wb_zypper` in docker/environments/wb-local/install-workbench.sh.
 */
const ZYPPER = `sudo env PATH=/usr/sbin:/usr/bin:/sbin:/bin zypper --non-interactive`;

/** The commands that add the Posit Pro repository, install the package, and remove it again. */
function packageCommands(manager: PackageManager): { addRepo: string; install: string; remove: string; repoFiles: string[] } {
	const rpmSetup = `curl -1sLf 'https://dl.posit.co/public/pro/setup.rpm.sh' | sudo -E bash`;
	switch (manager) {
		case 'apt':
			return {
				addRepo: `curl -1sLf 'https://dl.posit.co/public/pro/setup.deb.sh' | sudo -E bash`,
				install: 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y rstudio-drivers',
				remove: 'sudo apt-get purge -y rstudio-drivers',
				// The keyring is removed alongside the source list; leaving it would be harmless but
				// makes "are the drivers gone?" ambiguous for the next run.
				repoFiles: ['/etc/apt/sources.list.d/posit-pro.list', '/usr/share/keyrings/posit-pro-archive-keyring.gpg'],
			};
		case 'dnf':
			return {
				addRepo: rpmSetup,
				install: 'sudo dnf install -y rstudio-drivers',
				remove: 'sudo dnf remove -y rstudio-drivers',
				repoFiles: ['/etc/yum.repos.d/posit-pro.repo'],
			};
		case 'zypper':
			return {
				addRepo: rpmSetup,
				// --no-gpg-checks because the Posit repo's key is imported by the setup script into
				// rpm's keyring, not zypper's, so a fresh repo would otherwise stop for a prompt
				// that --non-interactive answers with "no".
				install: `${ZYPPER} --no-gpg-checks install rstudio-drivers`,
				remove: `${ZYPPER} remove rstudio-drivers`,
				repoFiles: ['/etc/zypp/repos.d/posit-pro.repo'],
			};
	}
}

/**
 * Shell snippet that prints the host's package manager. Ordered apt -> dnf -> zypper: openSUSE has
 * neither of the first two, so it falls through, and checking for `zypper` by name would be the one
 * probe that conda's PATH could not confuse anyway.
 */
const DETECT_MANAGER = `if command -v apt-get > /dev/null; then echo apt; elif command -v dnf > /dev/null; then echo dnf; else echo zypper; fi`;

/**
 * The DSN definitions the pane should discover. Written as a file and copied in rather than
 * heredoc'd through `docker exec`, so a password containing shell metacharacters can't break the
 * command (the same reason the enforced-settings suite copies its JSON in).
 */
function odbcIniContents(): string {
	const dsn = (name: string, database: string) => [
		`[${name}]`,
		`Driver   = PostgreSQL`,
		`Server   = ${PG_HOST}`,
		`Port     = ${PG_PORT}`,
		`Database = ${database}`,
		`UID      = ${PG_USER}`,
		`PWD      = ${PG_PASSWORD}`,
		'',
	].join('\n');

	return [
		'# Written by the pro-drivers e2e suite; removed on teardown.',
		'',
		dsn(PERIODIC_DSN, 'periodic'),
		dsn(DVDRENTAL_DSN, 'dvdrental'),
	].join('\n');
}

test.describe('Workbench: Posit Pro Drivers', {
	tag: [tags.WORKBENCH, tags.CONNECTIONS]
}, () => {

	test.beforeAll('Install the Pro Drivers and define the DSNs', async function ({ app, runDockerCommand }) {
		// The install pulls ~55MB from dl.posit.co and unpacks every driver in the bundle, which
		// takes appreciably longer than the default hook timeout.
		test.setTimeout(300_000);

		const probe = await runDockerCommand(
			`docker exec ${CONTAINER} bash -lc '${DETECT_MANAGER}; uname -m'`,
			'Detect the host package manager and architecture'
		);
		const [manager, arch] = probe.stdout.trim().split('\n').map(line => line.trim());

		// Posit publishes `rstudio-drivers` for el9 x86_64 but not el9 aarch64 (the aarch64 repo
		// carries only posit-chronicle). CI's Rocky lane is x86_64 so it runs there; this only bites
		// a local `npm run pwb -- --os=rocky9` on Apple Silicon, where it would otherwise fail with a
		// bare "Unable to find a match" from dnf. The sles build is x86_64-only too, but the openSUSE
		// container is always amd64 (Workbench has no arm64 openSUSE package at all), so it cannot
		// reach this.
		test.skip(manager !== 'apt' && arch === 'aarch64',
			'Posit Pro Drivers are not published for this OS on aarch64');

		const pkg = packageCommands(manager as PackageManager);

		await test.step('Install the Pro Drivers', async () => {
			await runDockerCommand(
				`docker exec ${CONTAINER} bash -lc "${pkg.addRepo}"`,
				'Add the Posit Pro repository'
			);
			await runDockerCommand(
				`docker exec ${CONTAINER} bash -lc '${pkg.install}'`,
				'Install the rstudio-drivers package'
			);
		});

		await test.step('Register the drivers with unixODBC', async () => {
			// Back up first, and only if no backup is already there: a leftover backup means an
			// earlier teardown did not run, so it -- not the current file -- is the last copy of the
			// host's original configuration. Overwriting it would lose that for good.
			//
			// Replacing rather than appending is what makes this correct on Rocky, whose stock file
			// already defines [PostgreSQL] (see the file header).
			await runDockerCommand(
				`docker exec ${CONTAINER} bash -lc '` + [
					`for f in ${ODBCINST_PATH} ${ODBCINI_PATH}; do`,
					`  if [ -f "$f" ] && [ ! -f "$f${BACKUP_SUFFIX}" ]; then sudo cp "$f" "$f${BACKUP_SUFFIX}"; fi`,
					`done`,
					`sudo cp ${DRIVERS_DIR}/odbcinst.ini.sample ${ODBCINST_PATH}`,
					`sudo chmod 0644 ${ODBCINST_PATH}`,
				].join('\n') + `'`,
				'Install odbcinst.ini from the drivers sample'
			);
		});

		await test.step('Verify the PostgreSQL driver is installed and registered', async () => {
			// Fail here rather than letting a bad install surface later as an empty pane. The two
			// halves are checked separately because they fail independently: a stanza can name a
			// `.so` that is not on disk (exactly what removing the package leaves behind), and a
			// duplicate stanza would mean the DSNs resolve to some other driver.
			const so = await runDockerCommand(
				`docker exec ${CONTAINER} bash -lc 'test -f ${POSTGRES_DRIVER_SO} && echo found || echo missing'`,
				'Check the PostgreSQL driver library exists'
			);
			expect(so.stdout.trim(), `expected ${POSTGRES_DRIVER_SO} on disk`).toBe('found');

			const registered = await runDockerCommand(
				`docker exec ${CONTAINER} bash -lc 'grep -c "^\\[PostgreSQL\\]" ${ODBCINST_PATH} || true'`,
				'Check the PostgreSQL driver is registered exactly once in odbcinst.ini'
			);
			expect(registered.stdout.trim(), `expected exactly one [PostgreSQL] stanza in ${ODBCINST_PATH}`).toBe('1');
		});

		await test.step('Define the DSNs', async () => {
			const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pro-drivers-'));
			const tmpOdbcIni = path.join(tmpDir, 'odbc.ini');
			await fs.promises.writeFile(tmpOdbcIni, odbcIniContents());
			try {
				await runDockerCommand(
					`docker cp "${tmpOdbcIni}" ${CONTAINER}:/tmp/odbc.ini`,
					'Copy odbc.ini into the container'
				);
				await runDockerCommand(
					`docker exec ${CONTAINER} bash -lc 'sudo mv /tmp/odbc.ini ${ODBCINI_PATH} && sudo chmod 0644 ${ODBCINI_PATH}'`,
					'Install odbc.ini'
				);
			} finally {
				await fs.promises.rm(tmpDir, { recursive: true, force: true });
			}
		});

		// Opened after the files are in place so the extension discovers them on activation. If a
		// previous suite in this worker already activated it, its watchers on odbcinst.ini/odbc.ini
		// pick the changes up instead -- either way the pane is current by the time it renders.
		await app.workbench.dataConnections.openDataConnectionsView();
	});

	test.afterAll('Remove the Pro Drivers', async function ({ runDockerCommand }) {
		test.setTimeout(120_000);

		const probe = await runDockerCommand(
			`docker exec ${CONTAINER} bash -lc '${DETECT_MANAGER}'`,
			'Detect the host package manager'
		);
		const pkg = packageCommands(probe.stdout.trim() as PackageManager);

		// Tolerant of a partial install: this has to undo whatever beforeAll got through before
		// failing (or before skipping), so removing an absent package must not abort the rest.
		//
		// Only `rstudio-drivers` is removed, not the dependencies it pulled in. On the rpm hosts
		// unixODBC ships in the base image and removing it would damage the container for every
		// later suite; on Ubuntu it arrives as a dependency, and leaving the driver-manager binaries
		// behind is harmless once the configuration below is restored. `apt-get autoremove` is
		// deliberately not used -- it would also collect anything else in the image that happens to
		// be orphaned.
		await runDockerCommand(
			`docker exec ${CONTAINER} bash -lc '` + [
				`${pkg.remove} || true`,
				`sudo rm -f ${pkg.repoFiles.join(' ')}`,
				// Restore rather than truncate: the original is empty on Ubuntu but carries the
				// distro's driver templates on the rpm hosts.
				`for f in ${ODBCINST_PATH} ${ODBCINI_PATH}; do`,
				`  if [ -f "$f${BACKUP_SUFFIX}" ]; then sudo mv "$f${BACKUP_SUFFIX}" "$f"; fi`,
				`done`,
				`exit 0`,
			].join('\n') + `'`,
			'Remove the Pro Drivers and restore the ODBC configuration'
		);
	});

	test('Detects DSNs from the ODBC configuration', async function ({ app }) {
		const { dataConnections } = app.workbench;

		// The badge, not just the row: it is what distinguishes a connection the machine's ODBC
		// configuration provides from one a user saved.
		await dataConnections.expectConnectionDetected(PERIODIC_DSN);
		await dataConnections.expectConnectionDetected(DVDRENTAL_DSN);
	});

	test('Browses a detected connection to data in the Data Explorer', {
		tag: [tags.DATA_EXPLORER]
	}, async function ({ app }) {
		const { dataConnections, dataExplorer } = app.workbench;

		await test.step('Expand the tree down to tables', async () => {
			await dataConnections.expandConnection(PERIODIC_DSN);
			// No 'Schemas' or 'public' row to expand: #15859 made the tree hide a connection's
			// schema level when there is only one schema, and the `periodic` database has exactly
			// one once the driver filters out pg_catalog, information_schema and pg_toast. So
			// Tables sits directly under the connection. Same fix as #15873 made for the Redshift
			// suite; this spec landed alongside that change and missed it.
			await dataConnections.expandNode('Tables');
		});

		await dataConnections.doubleClickNode('elements', 'table');

		await dataExplorer.waitForIdle();
		await dataExplorer.grid.expectColumnHeadersToBe(ELEMENTS_COLUMNS);

		await test.step('Verify the first row of data', async () => {
			for (const [colIndex, value] of ELEMENTS_FIRST_ROW.entries()) {
				await dataExplorer.grid.expectCellContentToBe({ rowIndex: 0, colIndex, value });
			}
		});
	});
});
