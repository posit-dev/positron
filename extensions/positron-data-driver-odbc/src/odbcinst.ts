/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Discovery of the ODBC configuration on this machine: which ODBC drivers are installed, and
// which data sources (DSNs) are defined.
//
// "Driver" is overloaded here. Throughout this extension, an *ODBC driver* is the vendor library
// (libsnowflakeodbc.dylib, psqlodbcw.so, ...) named in odbcinst.ini; a *Positron driver* is what
// odbcDriver.ts registers with positron.dataConnections. This module only deals in the former.
//
// Everything here is a pure function over an injected IOdbcConfigHost, so the parsing and the
// precedence rules can be unit-tested against fixtures without touching the real filesystem or
// registry.

import * as path from 'path';

/** An ODBC driver installed on this machine, as declared in odbcinst.ini (or the registry). */
export interface OdbcDriverEntry {
	/** The section name, which is what a DSN's `Driver=` refers to (e.g. "PostgreSQL Unicode"). */
	readonly name: string;

	/** The driver's `Description`, when it declares one. */
	readonly description?: string;

	/** The path to the driver library. Absent when the entry declares no `Driver` key. */
	readonly driverPath?: string;

	/** Where the entry came from. User entries shadow system entries of the same name. */
	readonly scope: OdbcConfigScope;

	/** Every key/value in the section, keys lowercased. Retained for the mechanisms to draw on. */
	readonly attributes: Readonly<Record<string, string>>;
}

/** A data source defined in odbc.ini (or the registry). */
export interface OdbcDsnEntry {
	/** The DSN name, which is what `DSN=` in a connection string refers to. */
	readonly name: string;

	/** The DSN's `Description`, when it declares one. */
	readonly description?: string;

	/** The name of the ODBC driver this DSN uses, from its `Driver` key. */
	readonly driverName?: string;

	/** Where the entry came from. User entries shadow system entries of the same name. */
	readonly scope: OdbcConfigScope;

	/** Every key/value in the section, keys lowercased. Used to summarize the DSN in the pane. */
	readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Whether an entry came from the per-user configuration or the machine-wide one. A user entry
 * shadows a system entry with the same name, matching unixODBC's own lookup order.
 */
export type OdbcConfigScope = 'user' | 'system';

/** The discovered ODBC configuration. */
export interface OdbcConfiguration {
	readonly drivers: readonly OdbcDriverEntry[];
	readonly dsns: readonly OdbcDsnEntry[];

	/** The files and registry keys the configuration was read from, in order. For logging. */
	readonly sources: readonly string[];
}

/**
 * The host services discovery needs. Injected so tests can supply fixtures; `createNodeConfigHost`
 * returns the real implementation.
 */
export interface IOdbcConfigHost {
	/** The platform to resolve configuration for. */
	readonly platform: NodeJS.Platform;

	/** Reads a file, returning undefined when it does not exist or cannot be read. */
	readFile(filePath: string): string | undefined;

	/** Whether a path exists. Used to drop entries whose driver library is gone. */
	exists(filePath: string): boolean;

	/** The current user's home directory, where the per-user ini files live. */
	homeDir(): string;

	/** Reads an environment variable. */
	env(name: string): string | undefined;

	/**
	 * Enumerates the Windows ODBC registry. Returns undefined off Windows, or when the registry
	 * could not be read.
	 */
	readRegistry(): OdbcRegistrySnapshot | undefined;
}

/**
 * The shape discovery needs out of the Windows registry: the two index keys ("ODBC Drivers" and
 * "ODBC Data Sources") plus the per-entry attribute keys beneath each hive.
 */
export interface OdbcRegistrySnapshot {
	/** Driver name -> its attributes, from HKLM\SOFTWARE\ODBC\ODBCINST.INI. */
	readonly drivers: Record<string, Record<string, string>>;

	/** DSN name -> its attributes, from HKCU (user) and HKLM (system) SOFTWARE\ODBC\ODBC.INI. */
	readonly userDsns: Record<string, Record<string, string>>;
	readonly systemDsns: Record<string, Record<string, string>>;
}

// --- INI parsing ---

/**
 * Parses an ODBC ini file into sections. The format is the usual `[Section]` / `key = value`, with
 * `;` and `#` starting a comment. Keys are lowercased because ODBC treats them case-insensitively
 * (a DSN may spell it `Driver`, `DRIVER`, or `driver`); section names are preserved as written,
 * since they are the user-facing driver and DSN names.
 *
 * Exported for tests.
 */
export function parseIni(contents: string): Record<string, Record<string, string>> {
	const sections: Record<string, Record<string, string>> = {};
	let current: Record<string, string> | undefined;

	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith(';') || line.startsWith('#')) {
			continue;
		}

		const sectionMatch = /^\[(?<name>[^\]]*)\]$/.exec(line);
		if (sectionMatch) {
			const name = (sectionMatch.groups?.name ?? '').trim();
			// A repeated section merges into the first, which is what unixODBC does.
			current = sections[name] ??= {};
			continue;
		}

		// A key/value outside any section is not meaningful in an ODBC ini; skip it.
		if (current === undefined) {
			continue;
		}

		const separator = line.indexOf('=');
		if (separator === -1) {
			continue;
		}
		const key = line.slice(0, separator).trim().toLowerCase();
		if (key.length > 0) {
			current[key] = line.slice(separator + 1).trim();
		}
	}

	return sections;
}

/**
 * The section names unixODBC uses for its own bookkeeping rather than for a driver or a DSN.
 * `[ODBC Data Sources]` and `[ODBC Drivers]` are indexes of the other sections, and `[ODBC]` holds
 * driver-manager settings such as tracing. None of them describe something connectable.
 */
const RESERVED_SECTIONS = new Set(['odbc', 'odbc data sources', 'odbc drivers', 'default']);

function isReservedSection(name: string): boolean {
	return RESERVED_SECTIONS.has(name.trim().toLowerCase());
}

// --- unix path resolution ---

/**
 * Candidate directories for the machine-wide ini files when `ODBCSYSINI` is unset. unixODBC bakes
 * its SYSCONFDIR in at compile time, so the right directory depends on how it was installed:
 * `/etc` for a Debian/Ubuntu or RHEL-family package (and for the Workbench `rstudio-drivers`
 * install), `/etc/unixODBC` for the SUSE-family one, and the Homebrew prefixes on macOS. All of
 * them are checked, nearest-first, rather than guessing one.
 *
 * `/etc/unixODBC` is not hypothetical: openSUSE Leap 15.6 ships unixODBC built that way, so
 * `odbcinst -j` there reports `/etc/unixODBC/odbc.ini` as the system data sources file. Without it
 * in this list, a DSN an admin defined in the place their platform actually reads is invisible to
 * the pane -- and, worse, a stray `/etc/odbc.ini` is offered instead even though the driver manager
 * will never resolve it, producing a connection that appears and then cannot open.
 */
const SYSTEM_CONFIG_DIRS = ['/etc', '/etc/unixODBC', '/usr/local/etc', '/opt/homebrew/etc'];

/**
 * Resolves the ini files to read on a unix-like platform, in the order their entries should be
 * applied (system first, then user, so user entries win).
 *
 * Honors the three unixODBC environment variables:
 * - `ODBCSYSINI` overrides the directory holding the system `odbc.ini` and `odbcinst.ini`.
 * - `ODBCINSTINI` overrides the system driver file; relative values resolve against ODBCSYSINI.
 * - `ODBCINI` overrides the *user* DSN file outright, and is an absolute path.
 *
 * Exported for tests.
 */
export function resolveUnixConfigPaths(host: IOdbcConfigHost): {
	systemDrivers: string[];
	systemDsns: string[];
	userDrivers: string[];
	userDsns: string[];
} {
	const sysIni = host.env('ODBCSYSINI');
	const systemDirs = sysIni ? [sysIni] : SYSTEM_CONFIG_DIRS;

	const instIni = host.env('ODBCINSTINI');
	const systemDrivers = instIni
		? (path.isAbsolute(instIni) ? [instIni] : systemDirs.map(dir => path.join(dir, instIni)))
		: systemDirs.map(dir => path.join(dir, 'odbcinst.ini'));

	const systemDsns = systemDirs.map(dir => path.join(dir, 'odbc.ini'));

	const home = host.homeDir();
	const userDsnOverride = host.env('ODBCINI');

	return {
		systemDrivers,
		systemDsns,
		// There is no environment override for the per-user driver file.
		userDrivers: [path.join(home, '.odbcinst.ini')],
		userDsns: userDsnOverride ? [userDsnOverride] : [path.join(home, '.odbc.ini')],
	};
}

// --- Discovery ---

/**
 * Reads the ODBC configuration for this machine.
 *
 * Entries whose driver library no longer exists are dropped: a driver uninstalled without its
 * odbcinst.ini entry being cleaned up is common, and offering it would produce a connection that
 * can only fail. DSNs are kept even when their driver is missing, so the pane can explain why one
 * it used to be able to reach no longer works.
 */
export function discoverOdbcConfiguration(host: IOdbcConfigHost): OdbcConfiguration {
	return host.platform === 'win32' ? discoverWindows(host) : discoverUnix(host);
}

function discoverUnix(host: IOdbcConfigHost): OdbcConfiguration {
	const paths = resolveUnixConfigPaths(host);
	const sources: string[] = [];

	// Later reads overwrite earlier ones, so system is read before user.
	const driverSections = new Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>();
	const dsnSections = new Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>();

	const readInto = (
		target: Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>,
		filePaths: readonly string[],
		scope: OdbcConfigScope
	) => {
		for (const filePath of filePaths) {
			const contents = host.readFile(filePath);
			if (contents === undefined) {
				continue;
			}
			sources.push(filePath);
			for (const [name, section] of Object.entries(parseIni(contents))) {
				if (!isReservedSection(name)) {
					target.set(name, { section, scope });
				}
			}
		}
	};

	readInto(driverSections, paths.systemDrivers, 'system');
	readInto(driverSections, paths.userDrivers, 'user');
	readInto(dsnSections, paths.systemDsns, 'system');
	readInto(dsnSections, paths.userDsns, 'user');

	const drivers = buildDrivers(host, driverSections);
	const dsns = buildDsns(dsnSections);

	return { drivers, dsns, sources };
}

function discoverWindows(host: IOdbcConfigHost): OdbcConfiguration {
	const registry = host.readRegistry();
	if (registry === undefined) {
		return { drivers: [], dsns: [], sources: [] };
	}

	const driverSections = new Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>();
	for (const [name, section] of Object.entries(registry.drivers)) {
		if (!isReservedSection(name)) {
			// Windows has no per-user driver registration in practice; drivers are machine-wide.
			driverSections.set(name, { section: lowercaseKeys(section), scope: 'system' });
		}
	}

	const dsnSections = new Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>();
	for (const [name, section] of Object.entries(registry.systemDsns)) {
		if (!isReservedSection(name)) {
			dsnSections.set(name, { section: lowercaseKeys(section), scope: 'system' });
		}
	}
	// User DSNs shadow system DSNs of the same name, as they do on unix.
	for (const [name, section] of Object.entries(registry.userDsns)) {
		if (!isReservedSection(name)) {
			dsnSections.set(name, { section: lowercaseKeys(section), scope: 'user' });
		}
	}

	return {
		drivers: buildDrivers(host, driverSections),
		dsns: buildDsns(dsnSections),
		sources: ['HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI', 'HKLM\\SOFTWARE\\ODBC\\ODBC.INI', 'HKCU\\SOFTWARE\\ODBC\\ODBC.INI'],
	};
}

function lowercaseKeys(section: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(section)) {
		result[key.toLowerCase()] = value;
	}
	return result;
}

function buildDrivers(
	host: IOdbcConfigHost,
	sections: Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>
): OdbcDriverEntry[] {
	const drivers: OdbcDriverEntry[] = [];
	for (const [name, { section, scope }] of sections) {
		const driverPath = section['driver'];

		// Drop entries whose library is gone. A driver uninstalled without its odbcinst.ini entry
		// being removed is common enough that offering it would mostly produce failed connections.
		if (driverPath !== undefined && !host.exists(driverPath)) {
			continue;
		}

		drivers.push({
			name,
			description: section['description'],
			driverPath,
			scope,
			attributes: section,
		});
	}
	return drivers.sort((a, b) => a.name.localeCompare(b.name));
}

function buildDsns(
	sections: Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>
): OdbcDsnEntry[] {
	const dsns: OdbcDsnEntry[] = [];
	for (const [name, { section, scope }] of sections) {
		dsns.push({
			name,
			description: section['description'],
			driverName: section['driver'],
			scope,
			attributes: section,
		});
	}
	return dsns.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Summaries ---

/**
 * Builds a one-line summary of where a DSN points, for the pane to show beneath its name (e.g.
 * "localhost:5432/pagila"). DSN attribute names are not standardized across ODBC drivers, so each
 * field is looked up under the several spellings drivers actually use. Returns undefined when the
 * DSN declares nothing recognizable.
 */
export function summarizeDsn(dsn: OdbcDsnEntry): string | undefined {
	const attribute = (...keys: string[]): string | undefined => {
		for (const key of keys) {
			const value = dsn.attributes[key];
			if (value !== undefined && value.length > 0) {
				return value;
			}
		}
		return undefined;
	};

	const server = attribute('server', 'servername', 'host', 'hostname');
	const port = attribute('port', 'portnumber');
	const database = attribute('database', 'databasename', 'db');

	const endpoint = server === undefined
		? undefined
		: port === undefined ? server : `${server}:${port}`;

	if (endpoint !== undefined && database !== undefined) {
		return `${endpoint}/${database}`;
	}
	return endpoint ?? database ?? dsn.description;
}
