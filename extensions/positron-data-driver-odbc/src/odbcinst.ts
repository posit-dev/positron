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

/** Why a data source found in the configuration was not offered. */
export type OdbcSkipReason = 'missing-library' | 'unregistered-driver';

/**
 * A data source that was found but left out, and why. Reported as data rather than logged, so
 * this module stays a pure function over its host and the caller decides whether to say anything.
 */
export interface OdbcSkippedDsn {
	/** The DSN name, as written in odbc.ini or in the registry. */
	readonly name: string;

	/** Which rule dropped it. */
	readonly reason: OdbcSkipReason;

	/**
	 * The library path that does not exist ('missing-library'), or the driver name that nothing
	 * is registered under ('unregistered-driver').
	 */
	readonly detail: string;
}

/** The discovered ODBC configuration. */
export interface OdbcConfiguration {
	readonly drivers: readonly OdbcDriverEntry[];
	readonly dsns: readonly OdbcDsnEntry[];

	/**
	 * Data sources that were found but not offered, because their ODBC driver could not be
	 * resolved. Reported so the log can explain a DSN that is missing from the pane.
	 */
	readonly skippedDsns: readonly OdbcSkippedDsn[];

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
 * Entries whose driver library no longer exists are dropped, drivers and data sources alike: a
 * driver uninstalled or moved without its ini entry being cleaned up is common, and offering
 * either would produce a connection that can only fail. A data source is dropped on the same
 * grounds when its `Driver` names nothing registered. What was dropped is reported in
 * `skippedDsns` rather than logged here, so this stays a pure function over its host.
 */
export function discoverOdbcConfiguration(host: IOdbcConfigHost): OdbcConfiguration {
	return host.platform === 'win32' ? discoverWindows(host) : discoverUnix(host);
}

/**
 * Whether two discoveries found the same drivers and data sources, and dropped the same ones.
 *
 * `sources` is left out on purpose. It lists every file that could be read, so an ini file that
 * appears empty changes it without changing anything that can be connected to. unixODBC creates
 * an empty `~/.odbc.ini` on the first connection attempt when there is none, and treating that as
 * a change would re-register the drivers and break the connection that caused it.
 *
 * @param a One discovery.
 * @param b The other.
 * @returns True when re-registering the drivers for `b` would change nothing `a` registered.
 */
export function isSameConfiguration(a: OdbcConfiguration, b: OdbcConfiguration): boolean {
	// Both sides are built by the same code in the same order, so a structural comparison of the
	// serialized form is exact.
	const connectable = (config: OdbcConfiguration) =>
		JSON.stringify({ drivers: config.drivers, dsns: config.dsns, skippedDsns: config.skippedDsns });
	return connectable(a) === connectable(b);
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

	// Whether any driver is registered, not whether a driver file was readable: unixODBC installs
	// commonly ship an empty odbcinst.ini, or one holding only [ODBC], which says no more about the
	// driver manager's real configuration than finding no file at all.
	const drivers = buildDrivers(host, driverSections);
	const { dsns, skipped } = buildDsns(host, dsnSections, driverSections, driverSections.size > 0);

	return { drivers, dsns, skippedDsns: skipped, sources };
}

function discoverWindows(host: IOdbcConfigHost): OdbcConfiguration {
	const registry = host.readRegistry();
	if (registry === undefined) {
		return { drivers: [], dsns: [], skippedDsns: [], sources: [] };
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

	// A registry read that found no drivers at all is the Windows equivalent of reading no
	// odbcinst.ini, so an unrecognized driver name is not held against the DSN.
	const { dsns, skipped } = buildDsns(host, dsnSections, driverSections, driverSections.size > 0);

	return {
		drivers: buildDrivers(host, driverSections),
		dsns,
		skippedDsns: skipped,
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

/**
 * Whether a DSN's `Driver` value names a library file rather than an odbcinst.ini section.
 *
 * Only an absolute path counts. unixODBC treats any other DSN `Driver` value as a driver name, a
 * bare `libmyodbc.so` included, so that is how findDsnDriverProblem looks it up.
 *
 * Both separators are checked whatever platform this runs on, because a Windows registry snapshot
 * is parsed on the developer's machine and in CI as readily as on Windows.
 */
export function isLibraryPath(value: string): boolean {
	return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

/**
 * Whether a bare (non-absolute) value looks like a shared-library filename rather than an ODBC
 * driver name, judging by extension alone. An odbcinst.ini section is essentially never named
 * "something.so", so the extension is enough to tell them apart.
 *
 * unixODBC hands a library value to dlopen(), which resolves a bare filename against the dynamic
 * linker's own search path (LD_LIBRARY_PATH, ld.so.cache). This module has no way to reproduce that
 * search, so whether such a library exists cannot be checked here.
 *
 * A `.so` may carry a version suffix (`libodbcpsql.so.2`), the usual Linux soname convention, so
 * that is matched too.
 */
export function looksLikeLibraryFilename(value: string): boolean {
	return /\.(so(\.\d+)*|dylib|dll)$/i.test(value);
}

/**
 * Looks a driver section up by name, case-insensitively, as ODBC compares driver names.
 *
 * driverSections is keyed on the section name exactly as written, so a user file re-registering a
 * driver under different casing than the system file (e.g. "postgresql unicode" over "PostgreSQL
 * Unicode") does not overwrite the system entry's Map key the way a same-case override would --
 * both survive as separate entries, with the system one inserted first. A plain first-match scan
 * would therefore return the stale system entry every time, silently defeating the override. A
 * user-scope match is preferred whenever one exists, to honor the same shadowing every other
 * precedence check in this module gives it -- see OdbcConfigScope.
 */
function findDriverSection(
	driverSections: Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>,
	name: string
): Record<string, string> | undefined {
	const wanted = name.toLowerCase();
	let systemMatch: Record<string, string> | undefined;
	for (const [candidate, { section, scope }] of driverSections) {
		if (candidate.toLowerCase() !== wanted) {
			continue;
		}
		if (scope === 'user') {
			return section;
		}
		systemMatch ??= section;
	}
	return systemMatch;
}

/**
 * Decides whether a DSN can reach an ODBC driver at all, returning the reason it cannot when it
 * cannot. This is the DSN-side counterpart of the library check buildDrivers applies to drivers.
 *
 * The bias throughout is toward keeping the DSN. This decides whether a row disappears from the
 * pane, and a data source wrongly hidden is a worse failure than a visible one that errors when
 * the user opens it.
 *
 * @param host The config host, for the library existence check.
 * @param dsn The DSN's attributes, keys already lowercased.
 * @param driverSections Every odbcinst.ini section, before buildDrivers dropped any, so a DSN
 * naming an uninstalled driver is reported as the missing library rather than as an unknown name.
 * @param sawDriverConfig Whether any driver is registered in what was read. When none is, an
 * unrecognized name says more about our search path than about the DSN: see SYSTEM_CONFIG_DIRS on
 * why unixODBC's SYSCONFDIR can sit outside it.
 * @returns The reason to drop the DSN, or undefined to keep it.
 */
function findDsnDriverProblem(
	host: IOdbcConfigHost,
	dsn: Record<string, string>,
	driverSections: Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>,
	sawDriverConfig: boolean
): { reason: OdbcSkipReason; detail: string } | undefined {
	const declared = dsn['driver']?.trim();
	if (declared === undefined || declared.length === 0) {
		// Nothing declared, so nothing to rule out. The driver manager may still resolve this
		// through a default; that is its business.
		return undefined;
	}

	if (isLibraryPath(declared)) {
		return host.exists(declared) ? undefined : { reason: 'missing-library', detail: declared };
	}

	const section = findDriverSection(driverSections, declared);
	if (section === undefined) {
		return sawDriverConfig ? { reason: 'unregistered-driver', detail: declared } : undefined;
	}

	// Only an absolute path can be existence-checked. A registered driver naming its own library by
	// a bare filename is trusted, since unixODBC does load that one, through the dynamic linker's
	// search path (see looksLikeLibraryFilename).
	const libraryPath = section['driver'];
	if (libraryPath !== undefined && isLibraryPath(libraryPath) && !host.exists(libraryPath)) {
		return { reason: 'missing-library', detail: libraryPath };
	}

	return undefined;
}

function buildDsns(
	host: IOdbcConfigHost,
	sections: Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>,
	driverSections: Map<string, { section: Record<string, string>; scope: OdbcConfigScope }>,
	sawDriverConfig: boolean
): { dsns: OdbcDsnEntry[]; skipped: OdbcSkippedDsn[] } {
	const dsns: OdbcDsnEntry[] = [];
	const skipped: OdbcSkippedDsn[] = [];

	for (const [name, { section, scope }] of sections) {
		const problem = findDsnDriverProblem(host, section, driverSections, sawDriverConfig);
		if (problem !== undefined) {
			skipped.push({ name, reason: problem.reason, detail: problem.detail });
			continue;
		}

		dsns.push({
			name,
			driverName: section['driver'],
			scope,
			attributes: section,
		});
	}

	return {
		dsns: dsns.sort((a, b) => a.name.localeCompare(b.name)),
		skipped: skipped.sort((a, b) => a.name.localeCompare(b.name)),
	};
}

// --- Summaries ---

/**
 * Builds a one-line summary of where a DSN points, for the pane to show beneath its name (e.g.
 * "localhost:5432/pagila"). DSN attribute names are not standardized across ODBC drivers, so each
 * field is looked up under the several spellings drivers actually use.
 *
 * Returns undefined when the DSN declares no endpoint at all. The DSN's own Description is not
 * used as a fallback: the summary answers where the data source points, and a description does
 * not. The caller says so explicitly instead.
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
	return endpoint ?? database;
}
