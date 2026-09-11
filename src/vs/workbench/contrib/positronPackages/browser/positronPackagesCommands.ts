/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession, IPackageVulnerability } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from './interfaces/positronPackagesService.js';
import { severityBand, VulnerabilitySeverityBand } from './packageVulnerabilities.js';
import { IPackagesSnapshot, IPositronPackagesInstance, PackagesMetadataStatus, PackagesVulnerabilityStatus } from './positronPackagesInstance.js';
import { PACKAGES_ENABLED_KEY, PACKAGES_ENABLED_LEGACY_KEY } from './positronPackagesContextKeys.js';

/**
 * Whether the packages commands should produce a payload at all: they go quiet
 * when the Packages pane is turned off. The commands stay registered either
 * way, so Assistant-side feature detection is a simple getCommands() check.
 *
 * Deliberately not gated on the ai.enabled main switch. This reports the
 * user's own environment; it doesn't call a model or surface an AI action,
 * which is what ai.enabled is for. The other agentCompatible package commands
 * (refresh, install, update) don't gate on it either, and Assistant is itself
 * gated on ai.enabled -- so gating here would only take the inspect action in
 * positronPackagesInspectActions.ts away from a user who turned AI off for
 * unrelated reasons.
 * @param configurationService The configuration service.
 */
function isPackagesCommandEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(PACKAGES_ENABLED_KEY) === true &&
		configurationService.getValue<boolean>(PACKAGES_ENABLED_LEGACY_KEY) === true;
}

/**
 * Hard cap on a description's length in the getAllPackages payload. That command
 * lists a whole environment -- hundreds of packages -- for an agent to size up
 * at once, so a single package with a long description must not crowd the rest
 * out of the token budget. The full description, and the fields left out of the
 * list entirely, are served per package by getPackages.
 */
const MAX_LIST_DESCRIPTION_LENGTH = 256;

/**
 * Truncates a description to {@link MAX_LIST_DESCRIPTION_LENGTH}, marking a cut
 * one so a reader can tell it was shortened rather than being this brief.
 * @param text The description as the session reported it.
 */
function truncateDescription(text: string): string {
	return text.length > MAX_LIST_DESCRIPTION_LENGTH
		? `${text.slice(0, MAX_LIST_DESCRIPTION_LENGTH).trimEnd()}...`
		: text;
}

/**
 * A single security advisory affecting an installed package version, as the
 * package commands report it. Mirrors {@link IPackageVulnerability} with the
 * severity band the pane renders resolved for the caller.
 */
export interface IPackagesCommandVulnerability {
	/** Preferred display id: the CVE when one exists, otherwise the OSV id. */
	id: string;

	/** OSV record id (PYSEC-*, GHSA-*, RSEC-*) the advisory came from. */
	osvId: string;

	/**
	 * CVSS base score (0-10). Absent when no aliased record carries one, which
	 * is the common case for CRAN's RSEC advisories: "vulnerable, score
	 * unknown" is a real state, not a missing field.
	 */
	score?: number;

	/** Which CVSS revision `score` came from. */
	scoreVersion?: 'v3' | 'v4';

	/**
	 * NVD severity band for `score` (critical/high/medium/low), or 'unscored'
	 * when the advisory carries no score. Always present, so a caller can rank
	 * advisories without reimplementing the score thresholds.
	 */
	severity: VulnerabilitySeverityBand;

	/** One-line advisory summary. */
	summary?: string;

	/**
	 * Display-ready fixed version(s), e.g. "1.26.5" or "1.26.5, 2.0.2" when the
	 * advisory has fixes on several release branches. Not machine-comparable:
	 * version semantics stay with the language runtimes.
	 */
	fixedIn?: string;

	/** ISO 8601 publication date of the advisory. */
	published?: string;

	/** Advisory URL (NVD page for CVEs, osv.dev page otherwise). */
	url?: string;
}

/**
 * The Package Manager instance that served the advisories in a payload, and
 * when -- so a caller can say where the advisory data came from and how old it
 * is, rather than presenting it as timeless fact.
 */
export interface IPackagesCommandVulnerabilitySource {
	/** Host that answered, e.g. 'ppm.example.com'. */
	host: string;

	/** ISO 8601 timestamp at which the lookup completed. */
	fetchedAt: string;
}

/**
 * The session a payload describes. Named rather than implied so a caller
 * holding several sessions can tell which environment it just read, and so a
 * stale answer is recognizable as one.
 */
export interface IPackagesCommandSession {
	sessionId: string;
	sessionName: string;
	languageId: string;
	languageName: string;
	languageVersion: string;
	runtimeName: string;
}

/**
 * A single installed package in the getAllPackages list: the compact shape,
 * sized so a whole environment fits an agent's token budget.
 *
 * Deliberately lean. Security advisories and the detail fields (license,
 * publication date, author, source repository, title) are left out; the
 * description is capped. All of them are served per package by getPackages.
 */
export interface IAllPackagesCommandPackage {
	name: string;

	/** The installed version. */
	version: string;

	/**
	 * The newest version available to the session. Absent when nothing newer
	 * exists, or when outdated state could not be obtained -- see
	 * {@link IAllPackagesCommandResult.metadataStatus}.
	 */
	latestVersion?: string;

	/** Whether the installed version is older than `latestVersion`. */
	outdated?: boolean;

	/**
	 * Whether the package is on the session's search path: attached with
	 * `library()` in R, bound to a name in the user namespace in Python.
	 * Distinct from installed, and from loaded as a transitive dependency.
	 */
	attached?: boolean;

	/**
	 * One-line summary, when the session's package list carries one, capped at
	 * {@link MAX_LIST_DESCRIPTION_LENGTH} and suffixed with "..." when cut. Call
	 * getPackages for the full text.
	 */
	description?: string;

	/** The package's primary external URL (homepage, falling back to repository). */
	url?: string;
}

/**
 * A single package in the getPackages payload: the full per-package shape, with
 * the detail fields and security advisories the list omits.
 */
export interface IPackageCommandPackage {
	name: string;

	/** The installed version. */
	version: string;

	/** The newest version available to the session, when known. */
	latestVersion?: string;

	/** Whether the installed version is older than `latestVersion`. */
	outdated?: boolean;

	/** Whether the package is on the session's search path. */
	attached?: boolean;

	/** Full one-line summary (uncapped, unlike the list). */
	description?: string;

	/** The package's primary external URL (homepage, falling back to repository). */
	url?: string;

	/** License information, from the detail lookup. */
	license?: string;

	/** Display-ready author/maintainer string, from the detail lookup. */
	author?: string;

	/** Source repository label or URL (e.g. "CRAN"), from the detail lookup. */
	sourceRepository?: string;

	/** Publication/release date, from the detail lookup. */
	publishedDate?: string;

	/** One-line title/summary, richer than `description`, from the detail lookup. */
	title?: string;

	/**
	 * Known security advisories affecting *this* installed version, worst-scored
	 * first.
	 *
	 * Three states, all meaningful:
	 * - a non-empty array: the installed version is affected.
	 * - an empty array: the repository knows this version and reports nothing
	 *   against it -- an all-clear, not a missing answer.
	 * - absent: no advisory data for this package, so nothing can be concluded
	 *   either way. See {@link IPackageCommandResult.vulnerabilityStatus}.
	 */
	vulnerabilities?: IPackagesCommandVulnerability[];
}

/**
 * The getAllPackages payload: the compact list of what is installed in the
 * foreground session.
 */
export interface IAllPackagesCommandResult {
	available: true;

	session: IPackagesCommandSession;

	/** How far the `outdated` state below can be trusted. */
	metadataStatus: PackagesMetadataStatus;

	packages: IAllPackagesCommandPackage[];
}

/**
 * The getPackages payload: full detail on the packages the caller named.
 */
export interface IPackageCommandResult {
	available: true;

	session: IPackagesCommandSession;

	/** How far the `outdated` state below can be trusted. */
	metadataStatus: PackagesMetadataStatus;

	/**
	 * How the security advisories below were obtained. Tracked separately from
	 * `metadataStatus` because the two come from different sources: outdated
	 * state from the runtime's package manager, advisories from Posit Package
	 * Manager, and either can fail while the other answers.
	 */
	vulnerabilityStatus: PackagesVulnerabilityStatus;

	/**
	 * Which Package Manager instance served the advisories, and when. Absent
	 * when the payload carries none to attribute.
	 */
	vulnerabilitySource?: IPackagesCommandVulnerabilitySource;

	/** The named packages that are installed, with full detail. */
	packages: IPackageCommandPackage[];

	/**
	 * The named packages that are not installed in the session. Empty when every
	 * requested package was found. A name here is a definitive "not installed",
	 * not a truncated-away answer -- which is the whole point of naming packages
	 * rather than scanning the list.
	 */
	notFound: string[];
}

/**
 * Why a package command produced no payload. Distinguishing these is the point:
 * each calls for a different next step, and a caller can't read the log line
 * that says which happened.
 *
 * - `disabled`: the Packages pane is turned off in settings.
 * - `no-session`: no interpreter session is running, so there is no
 *   environment to report.
 * - `session-not-ready`: a session exists but is still starting up (or has
 *   exited); asking it now would hang rather than answer. Worth retrying.
 * - `unsupported`: the session's runtime doesn't implement package management.
 * - `failed`: the session was asked and the read failed; `message` says how.
 */
export type PackagesUnavailableReason =
	| 'disabled'
	| 'no-session'
	| 'session-not-ready'
	| 'unsupported'
	| 'failed';

/**
 * What a package command returns in place of a payload. `available: false` is
 * the discriminant against the available results.
 */
export interface IPackagesCommandUnavailableResult {
	available: false;

	reason: PackagesUnavailableReason;

	/** The underlying error, present when `reason` is `failed`. */
	message?: string;
}

/**
 * What getPackages returns when the caller named no packages. Its own
 * discriminant (`reason: 'no-names'`), kept apart from the environment reasons
 * above because it is a bad call, not a state of the session.
 */
export interface IPackageNoNamesResult {
	available: false;

	reason: 'no-names';
}

/** What getAllPackages resolves to. */
export type AllPackagesCommandResult = IAllPackagesCommandResult | IPackagesCommandUnavailableResult;

/** What getPackages resolves to. */
export type PackageCommandResult = IPackageCommandResult | IPackagesCommandUnavailableResult | IPackageNoNamesResult;

/**
 * The runtime states in which a session can answer a package query. Mirrors
 * the check the packages instance makes before its first refresh: outside
 * these, the kernel either isn't listening yet or is gone.
 */
const READABLE_RUNTIME_STATES: readonly RuntimeState[] = [
	RuntimeState.Ready,
	RuntimeState.Idle,
	RuntimeState.Busy,
];

/**
 * Describes the session a payload came from.
 * @param session The runtime session.
 */
function describeSession(session: ILanguageRuntimeSession): IPackagesCommandSession {
	return {
		sessionId: session.sessionId,
		sessionName: session.dynState.sessionName,
		languageId: session.runtimeMetadata.languageId,
		languageName: session.runtimeMetadata.languageName,
		languageVersion: session.runtimeMetadata.languageVersion,
		runtimeName: session.runtimeMetadata.runtimeName,
	};
}

/**
 * Maps one advisory to its payload shape, resolving the severity band so the
 * caller can rank advisories without knowing the CVSS thresholds.
 * @param vulnerability The advisory as the lookup normalized it.
 */
function describeVulnerability(vulnerability: IPackageVulnerability): IPackagesCommandVulnerability {
	return {
		id: vulnerability.id,
		osvId: vulnerability.osvId,
		score: vulnerability.score,
		scoreVersion: vulnerability.scoreVersion,
		severity: severityBand(vulnerability.score),
		summary: vulnerability.summary,
		fixedIn: vulnerability.fixedIn,
		published: vulnerability.published,
		url: vulnerability.url,
	};
}

/**
 * Orders a package's advisories worst first: highest score, then the unscored
 * ones. The pane leads with the worst advisory too (see `worstVulnerability`),
 * so a caller reading only the first entry gets the same one a user sees.
 * Unscored advisories sort last rather than being dropped -- they are
 * known-vulnerable, only the severity is unknown.
 * @param vulnerabilities The advisories for one installed version.
 */
function describeVulnerabilities(vulnerabilities: readonly IPackageVulnerability[]): IPackagesCommandVulnerability[] {
	return vulnerabilities
		.map(describeVulnerability)
		.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/**
 * Maps a package to its compact list shape. Explicit rather than a spread so
 * the agent-facing contract doesn't quietly grow whichever fields the runtime
 * interface gains next.
 * @param pkg The package as the session reported it.
 */
function describeListPackage(pkg: ILanguageRuntimePackage): IAllPackagesCommandPackage {
	return {
		name: pkg.name,
		version: pkg.version,
		latestVersion: pkg.latestVersion,
		outdated: pkg.outdated,
		attached: pkg.attached,
		// Python's package list sends an empty string for a package with no
		// summary; an absent field says "unknown" without the caller having to
		// treat '' as a special case.
		description: pkg.description ? truncateDescription(pkg.description) : undefined,
		url: pkg.url,
	};
}

/**
 * Maps a package to its full detail shape, with the detail fields and
 * advisories the list omits.
 * @param pkg The package, with its detail fields already merged over the list entry.
 * @param includeVulnerabilities Whether advisory data may be reported at all.
 */
function describePackage(pkg: ILanguageRuntimePackage, includeVulnerabilities: boolean): IPackageCommandPackage {
	return {
		name: pkg.name,
		version: pkg.version,
		latestVersion: pkg.latestVersion,
		outdated: pkg.outdated,
		attached: pkg.attached,
		description: pkg.description || undefined,
		url: pkg.url,
		license: pkg.license,
		author: pkg.author,
		sourceRepository: pkg.sourceRepository,
		publishedDate: pkg.publishedDate,
		title: pkg.title,
		// Unlike the fields above, an empty array is kept rather than normalized
		// away: it is the all-clear, and collapsing it to undefined would report
		// "checked, nothing found" as "not checked".
		vulnerabilities: includeVulnerabilities && pkg.vulnerabilities
			? describeVulnerabilities(pkg.vulnerabilities)
			: undefined,
	};
}

/**
 * Describes the Package Manager instance the snapshot's advisories came from.
 * @param source The source, when the snapshot names one.
 */
function describeVulnerabilitySource(
	source: IPackagesSnapshot['vulnerabilitySource'],
): IPackagesCommandVulnerabilitySource | undefined {
	return source && {
		host: source.host,
		// Epoch ms in, ISO 8601 out: the payload is read by a caller that has
		// to talk about when this was fetched, not compute with it.
		fetchedAt: new Date(source.fetchedAt).toISOString(),
	};
}

/**
 * The active session's package snapshot, or the reason there is none to read.
 * Shared by both commands: everything up to and including the snapshot read is
 * identical; only how the packages are projected differs. `ok` discriminates.
 */
type SnapshotResolution =
	| { ok: true; session: ILanguageRuntimeSession; instance: IPositronPackagesInstance; snapshot: IPackagesSnapshot }
	| { ok: false; result: IPackagesCommandUnavailableResult };

/**
 * Reads the foreground session's package snapshot, mapping every way it can come
 * up empty to a reason the caller can act on. Never throws.
 * @param accessor The services accessor. Resolve it before the first await: a
 * ServicesAccessor stops being valid once the handler yields.
 * @param includeVulnerabilities Whether the snapshot should run the (slower)
 * advisory lookup. The list command opts out; the detail command needs it.
 */
async function resolveSnapshot(
	accessor: ServicesAccessor,
	includeVulnerabilities: boolean,
): Promise<SnapshotResolution> {
	const configurationService = accessor.get(IConfigurationService);
	const packagesService = accessor.get(IPositronPackagesService);
	const logService = accessor.get(ILogService);

	// The commands have no precondition (see registration below), so this is
	// how a caller learns the feature is off: a reason it can act on, rather
	// than an empty list indistinguishable from an empty environment.
	if (!isPackagesCommandEnabled(configurationService)) {
		return { ok: false, result: { available: false, reason: 'disabled' } };
	}

	const instance = packagesService.activePackagesInstance;
	if (!instance) {
		return { ok: false, result: { available: false, reason: 'no-session' } };
	}

	const session = instance.session;
	if (!READABLE_RUNTIME_STATES.includes(session.getRuntimeState())) {
		logService.debug(`[Packages] getPackages: session ${session.sessionId} is ${session.getRuntimeState()}.`);
		return { ok: false, result: { available: false, reason: 'session-not-ready' } };
	}

	let snapshot: IPackagesSnapshot;
	try {
		snapshot = await instance.getPackagesSnapshot(undefined, { includeVulnerabilities });
	} catch (err) {
		logService.warn(`[Packages] getPackages: failed to read packages for ${session.sessionId}: ${err}`);
		return {
			ok: false,
			result: {
				available: false,
				reason: 'failed',
				message: err instanceof Error ? err.message : String(err),
			},
		};
	}

	// A runtime with no package manager reports no packages, which on its own
	// reads as an empty environment; the reason keeps the two apart.
	if (snapshot.metadataStatus === 'unsupported' && snapshot.packages.length === 0) {
		return { ok: false, result: { available: false, reason: 'unsupported' } };
	}

	return { ok: true, session, instance, snapshot };
}

/**
 * Builds the getAllPackages payload: the compact list of packages installed in
 * the foreground session, each with its installed version and whether something
 * newer is available, for Assistant to size up the environment it is working in.
 *
 * Read-only and quiet -- no progress notification, no pane required. Never
 * throws: every way this can come up empty is reported as a reason the caller
 * can act on (see {@link PackagesUnavailableReason}).
 * @param accessor The services accessor.
 */
export async function getAllPackages(accessor: ServicesAccessor): Promise<AllPackagesCommandResult> {
	// The list never carries advisories, so it skips the advisory lookup rather
	// than paying for a whole-environment fetch on every call.
	const resolved = await resolveSnapshot(accessor, false);
	if (!resolved.ok) {
		return resolved.result;
	}

	return {
		available: true,
		session: describeSession(resolved.session),
		metadataStatus: resolved.snapshot.metadataStatus,
		packages: resolved.snapshot.packages.map(describeListPackage),
	};
}

/**
 * Builds the getPackages payload: full detail on each named package that is
 * installed in the foreground session -- its detail fields (license,
 * publication date, author, source repository) and any known security
 * advisories against the installed version -- plus the names that are not
 * installed. For looking one package up rather than reading the whole list.
 *
 * Read-only and quiet. Never throws: every way this can come up empty is a
 * reason the caller can act on.
 * @param accessor The services accessor.
 * @param args The package names to look up, as a string, an array of strings,
 * or several string arguments.
 */
export async function getPackages(accessor: ServicesAccessor, ...args: unknown[]): Promise<PackageCommandResult> {
	const names = normalizeNames(args);
	if (names.length === 0) {
		return { available: false, reason: 'no-names' };
	}

	const resolved = await resolveSnapshot(accessor, true);
	if (!resolved.ok) {
		return resolved.result;
	}

	const { instance, session, snapshot } = resolved;
	const vulnerabilitiesEnabled = snapshot.vulnerabilityStatus !== 'disabled';

	// Match requested names against the installed list case-insensitively (a
	// repository asked about 'Matrix' has been asked about 'matrix'), keeping
	// the caller's order. A name with no match is definitively not installed.
	const byName = new Map<string, ILanguageRuntimePackage>();
	for (const pkg of snapshot.packages) {
		const key = pkg.name.toLowerCase();
		if (!byName.has(key)) {
			byName.set(key, pkg);
		}
	}

	const found: ILanguageRuntimePackage[] = [];
	const notFound: string[] = [];
	for (const name of names) {
		const pkg = byName.get(name.toLowerCase());
		if (pkg) {
			found.push(pkg);
		} else {
			notFound.push(name);
		}
	}

	// The detail fields (license, author, source repository, published date) are
	// a per-package RPC, run only for the handful the caller named -- the reason
	// this command exists rather than the list carrying them for everything.
	// The advisories already rode in with the snapshot above.
	const packages = await Promise.all(found.map(async (pkg) => {
		const detail = await instance.getPackageDetail(pkg.name).catch(() => undefined);
		return describePackage({ ...pkg, ...detail }, vulnerabilitiesEnabled);
	}));

	return {
		available: true,
		session: describeSession(session),
		metadataStatus: snapshot.metadataStatus,
		vulnerabilityStatus: snapshot.vulnerabilityStatus,
		vulnerabilitySource: describeVulnerabilitySource(snapshot.vulnerabilitySource),
		packages,
		notFound,
	};
}

/**
 * Collects the package names from a command's arguments, accepting a single
 * string, an array of strings, or several string arguments. Trims each, drops
 * blanks, and deduplicates case-insensitively while keeping the first spelling.
 * @param args The raw command arguments.
 */
function normalizeNames(args: unknown[]): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	const add = (value: unknown): void => {
		if (typeof value !== 'string') {
			return;
		}
		const name = value.trim();
		const key = name.toLowerCase();
		if (name && !seen.has(key)) {
			seen.add(key);
			names.push(name);
		}
	};
	for (const arg of args) {
		if (Array.isArray(arg)) {
			arg.forEach(add);
		} else {
			add(arg);
		}
	}
	return names;
}

// The ids of the payload commands. One command per payload, matching every
// other agentCompatible command in the workbench, so each carries its own
// return contract and shows up on its own in the positron-commands skill's
// reference file (#15344).
export const PACKAGES_GET_ALL_PACKAGES_COMMAND_ID = 'positronPackages.getAllPackages';
export const PACKAGES_GET_PACKAGES_COMMAND_ID = 'positronPackages.getPackages';

// Registered through CommandsRegistry rather than registerAction2, so the
// payload commands take no Command Palette slot: running one would show the
// user nothing, since the return value is for a programmatic caller. The
// Command Palette entry that displays a payload lives in
// positronPackagesInspectActions.ts.
//
// That also means they have no precondition -- registerAction2 only records one
// in MenuRegistry when f1 is set, and MenuRegistry is the only place the agent
// path reads preconditions from. This is the always-registered pattern the
// payloads want: Assistant discovers the commands once, and learns the feature
// is off from the payload itself (reason 'disabled') rather than by the command
// vanishing from getAgentAllowedCommands() mid-session.
CommandsRegistry.registerCommand({
	id: PACKAGES_GET_ALL_PACKAGES_COMMAND_ID,
	handler: getAllPackages,
	metadata: {
		description: localize(
			'positron.packages.getAllPackages.description',
			"Read the packages installed in the running interpreter session, each with its version and whether a newer version is available. A compact list built to fit a whole environment at once: descriptions are shortened and security vulnerabilities and per-package detail (license, author, source repository, publication date) are left out. To get those, or the full description, call positronPackages.getPackages with the package names. Changes nothing and shows the user nothing: unlike Refresh Packages, it can be called at any time, including before the Packages pane has ever been opened."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		returns: 'An object with available: true, the session the packages belong to, the installed packages (name, version, latestVersion, outdated, attached, description, url) -- where description is shortened to 256 characters and suffixed with "..." when cut -- and metadataStatus saying how the outdated state was obtained: \'fresh\' (repositories queried now), \'cached\' (as of the last fetch), \'unsupported\' (this runtime reports no outdated state, so no package has it), \'timed-out\' (the list is complete but outdated state may be missing), or \'fetch-failed\' (the repository query errored; the list is complete, outdated state is whatever an earlier fetch cached). This list carries no security vulnerabilities and no per-package detail; call positronPackages.getPackages for those. When there are no packages to report, an object with available: false and a reason of \'disabled\', \'no-session\', \'session-not-ready\', \'unsupported\', or \'failed\' -- the last of which also carries a message.',
	},
});

CommandsRegistry.registerCommand({
	id: PACKAGES_GET_PACKAGES_COMMAND_ID,
	handler: getPackages,
	metadata: {
		description: localize(
			'positron.packages.getPackages.description',
			"Read full detail on specific packages in the running interpreter session: the version, whether a newer version is available, the full description, the detail fields (license, author, source repository, publication date), and any known security vulnerabilities affecting the installed version. Use this to look a package up by name -- including to check whether it is installed at all -- rather than reading the whole environment with positronPackages.getAllPackages. Changes nothing and shows the user nothing."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		args: [
			{ name: 'names', description: 'The package names to look up, as the package repository knows them (for example: dplyr, pandas). Pass an array of names, or a single name. Matching is case-insensitive.', schema: { type: 'array', items: { type: 'string' } } },
		],
		returns: 'An object with available: true, the session the packages belong to, packages (the named packages that are installed, with full detail), notFound (the named packages that are not installed -- a name here is a definitive "not installed", not a truncated-away answer), metadataStatus (how the outdated state was obtained: \'fresh\', \'cached\', \'unsupported\', \'timed-out\', or \'fetch-failed\'), and vulnerabilityStatus (how advisories were obtained). Each installed package carries name, version, latestVersion, outdated, attached, description, url, license, author, sourceRepository, publishedDate, title, and vulnerabilities. vulnerabilities are the security advisories against the installed version, worst first (id, osvId, score, scoreVersion, severity of \'critical\'/\'high\'/\'medium\'/\'low\'/\'unscored\', summary, fixedIn, published, url); an empty array means the repository was asked and reports nothing against that version, which is an all-clear, while an absent field means there is no advisory data for that package at all, which is not. vulnerabilityStatus says how the advisories were obtained: \'fresh\' (Package Manager queried now), \'cached\' (the cached advisories were still current), \'disabled\' (advisory lookups are turned off in settings), \'unavailable\' (a lookup ran and produced nothing, which is not worth retrying), or \'timed-out\' (the lookup ran out of time partway). vulnerabilitySource names the Package Manager host that served them and when it answered. When no packages are named, an object with available: false and reason \'no-names\'. When there are no packages to report at all, an object with available: false and a reason of \'disabled\', \'no-session\', \'session-not-ready\', \'unsupported\', or \'failed\' -- the last of which also carries a message.',
	},
});
