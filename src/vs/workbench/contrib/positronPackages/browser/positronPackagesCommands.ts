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
import { IPackagesSnapshot, PackagesMetadataStatus, PackagesVulnerabilityStatus } from './positronPackagesInstance.js';
import { PACKAGES_ENABLED_KEY, PACKAGES_ENABLED_LEGACY_KEY } from './positronPackagesContextKeys.js';

/**
 * Whether the packages command should produce a payload at all: it goes quiet
 * when the Packages pane is turned off. The command stays registered either
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
 * A single installed package, as the getPackages command reports it.
 *
 * Only the fields a session's package *list* actually carries are here.
 * License, publication date, author and source repository are served one
 * package at a time by the detail RPC (that's what the package editor opens
 * for), so including them would cost a round trip per package and, in
 * practice, be absent from every entry.
 */
export interface IPackagesCommandPackage {
	name: string;

	/** The installed version. */
	version: string;

	/**
	 * The newest version available to the session. Absent when nothing newer
	 * exists, or when outdated state could not be obtained -- see
	 * {@link IPackagesCommandResult.metadataStatus}.
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

	/** One-line summary, when the session's package list carries one. */
	description?: string;

	/** The package's primary external URL (homepage, falling back to repository). */
	url?: string;

	/**
	 * Known security advisories affecting *this* installed version, worst-scored
	 * first.
	 *
	 * Three states, all meaningful:
	 * - a non-empty array: the installed version is affected.
	 * - an empty array: the repository knows this version and reports nothing
	 *   against it -- an all-clear, not a missing answer.
	 * - absent: no advisory data for this package, so nothing can be concluded
	 *   either way. See {@link IPackagesCommandResult.vulnerabilityStatus}.
	 */
	vulnerabilities?: IPackagesCommandVulnerability[];
}

/**
 * A single security advisory affecting an installed package version, as the
 * getPackages command reports it. Mirrors {@link IPackageVulnerability} with
 * the severity band the pane renders resolved for the caller.
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
 * The Package Manager instance that served the advisories in the payload, and
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
 * The session the payload describes. Named rather than implied so a caller
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
 * The getPackages payload: what is installed in the foreground session.
 */
export interface IPackagesCommandResult {
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

	packages: IPackagesCommandPackage[];
}

/**
 * Why getPackages produced no payload. Distinguishing these is the point: each
 * calls for a different next step, and a caller can't read the log line that
 * says which happened.
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
 * What getPackages returns in place of a payload. `available: false` is the
 * discriminant against {@link IPackagesCommandResult}.
 */
export interface IPackagesCommandUnavailableResult {
	available: false;

	reason: PackagesUnavailableReason;

	/** The underlying error, present when `reason` is `failed`. */
	message?: string;
}

/**
 * What getPackages resolves to: the packages, or the reason there are none to
 * report.
 */
export type PackagesCommandResult = IPackagesCommandResult | IPackagesCommandUnavailableResult;

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
 * Maps a package to its payload shape. Explicit rather than a spread so the
 * agent-facing contract doesn't quietly grow whichever fields the runtime
 * interface gains next.
 * @param pkg The package as the session reported it.
 * @param includeVulnerabilities Whether advisory data may be reported at all.
 */
function describePackage(pkg: ILanguageRuntimePackage, includeVulnerabilities: boolean): IPackagesCommandPackage {
	return {
		name: pkg.name,
		version: pkg.version,
		latestVersion: pkg.latestVersion,
		outdated: pkg.outdated,
		attached: pkg.attached,
		// Python's package list sends an empty string for a package with no
		// summary; an absent field says "unknown" without the caller having to
		// treat '' as a special case.
		description: pkg.description || undefined,
		url: pkg.url,
		// Unlike the fields above, an empty array is kept rather than
		// normalized away: it is the all-clear, and collapsing it to undefined
		// would report "checked, nothing found" as "not checked".
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
 * Builds the getPackages payload: the packages installed in the foreground
 * session, each with its installed version, whether something newer is
 * available, and any known security advisories against the installed version,
 * for Assistant to reason about the environment it is working in.
 *
 * Read-only and quiet -- no progress notification, no pane required. Never
 * throws: every way this can come up empty is reported as a reason the caller
 * can act on (see {@link PackagesUnavailableReason}).
 * @param accessor The services accessor.
 */
export async function getPackages(accessor: ServicesAccessor): Promise<PackagesCommandResult> {
	// Everything is resolved before the first await: a ServicesAccessor stops
	// being valid once the handler yields.
	const configurationService = accessor.get(IConfigurationService);
	const packagesService = accessor.get(IPositronPackagesService);
	const logService = accessor.get(ILogService);

	// The command has no precondition (see its registration below), so this is
	// how a caller learns the feature is off: a reason it can act on, rather
	// than an empty list indistinguishable from an empty environment.
	if (!isPackagesCommandEnabled(configurationService)) {
		return { available: false, reason: 'disabled' };
	}

	const instance = packagesService.activePackagesInstance;
	if (!instance) {
		return { available: false, reason: 'no-session' };
	}

	const session = instance.session;
	if (!READABLE_RUNTIME_STATES.includes(session.getRuntimeState())) {
		logService.debug(`[Packages] getPackages: session ${session.sessionId} is ${session.getRuntimeState()}.`);
		return { available: false, reason: 'session-not-ready' };
	}

	let snapshot: IPackagesSnapshot;
	try {
		snapshot = await instance.getPackagesSnapshot();
	} catch (err) {
		logService.warn(`[Packages] getPackages: failed to read packages for ${session.sessionId}: ${err}`);
		return {
			available: false,
			reason: 'failed',
			message: err instanceof Error ? err.message : String(err),
		};
	}

	// A runtime with no package manager reports no packages, which on its own
	// reads as an empty environment; the reason keeps the two apart.
	if (snapshot.metadataStatus === 'unsupported' && snapshot.packages.length === 0) {
		return { available: false, reason: 'unsupported' };
	}

	// The snapshot reports 'disabled' from the same setting, but the packages
	// still carry whatever the cache holds: the status describes the read, this
	// drops the data it says isn't there.
	const vulnerabilitiesEnabled = snapshot.vulnerabilityStatus !== 'disabled';

	return {
		available: true,
		session: describeSession(session),
		metadataStatus: snapshot.metadataStatus,
		vulnerabilityStatus: snapshot.vulnerabilityStatus,
		vulnerabilitySource: describeVulnerabilitySource(snapshot.vulnerabilitySource),
		packages: snapshot.packages.map((pkg) => describePackage(pkg, vulnerabilitiesEnabled)),
	};
}

// The id of the payload command. One command per payload, matching every other
// agentCompatible command in the workbench, so it carries its own return
// contract and shows up on its own in the positron-commands skill's reference
// file (#15344).
export const PACKAGES_GET_PACKAGES_COMMAND_ID = 'positronPackages.getPackages';

// Registered through CommandsRegistry rather than registerAction2, so the
// payload command takes no Command Palette slot: running it would show the
// user nothing, since the return value is for a programmatic caller. The
// Command Palette entry that displays this payload lives in
// positronPackagesInspectActions.ts.
//
// That also means it has no precondition -- registerAction2 only records one in
// MenuRegistry when f1 is set, and MenuRegistry is the only place the agent
// path reads preconditions from. This is the always-registered pattern the
// payload wants: Assistant discovers the command once, and learns the feature
// is off from the payload itself (reason 'disabled') rather than by the command
// vanishing from getAgentAllowedCommands() mid-session.
CommandsRegistry.registerCommand({
	id: PACKAGES_GET_PACKAGES_COMMAND_ID,
	handler: getPackages,
	metadata: {
		description: localize(
			'positron.packages.getPackages.description',
			"Read the packages installed in the running interpreter session, with the version of each, whether a newer version is available, and any known security vulnerabilities affecting the installed version. Changes nothing and shows the user nothing: unlike Refresh Packages, it can be called at any time, including before the Packages pane has ever been opened."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		returns: 'An object with available: true, the session the packages belong to, the installed packages (name, version, latestVersion, outdated, attached, description, url, vulnerabilities), and metadataStatus saying how the outdated state was obtained: \'fresh\' (repositories queried now), \'cached\' (as of the last fetch), \'unsupported\' (this runtime reports no outdated state, so no package has it), \'timed-out\' (the list is complete but outdated state may be missing), or \'fetch-failed\' (the repository query errored; the list is complete, outdated state is whatever an earlier fetch cached). Each package\'s vulnerabilities are the security advisories against its installed version, worst first (id, osvId, score, scoreVersion, severity of \'critical\'/\'high\'/\'medium\'/\'low\'/\'unscored\', summary, fixedIn, published, url); an empty array means the repository was asked and reports nothing against that version, which is an all-clear, while an absent field means there is no advisory data for that package at all, which is not. vulnerabilityStatus says how the advisories were obtained: \'fresh\' (Package Manager queried now for every package), \'cached\' (the cached advisories were still current, so only packages with none were queried now), \'disabled\' (advisory lookups are turned off in settings), \'unavailable\' (a lookup ran and produced nothing: either no Package Manager here reports advisories or the lookup failed, and neither is worth retrying), or \'timed-out\' (the lookup outran its budget; the package list is complete and the advisories are whatever was cached). A package with no advisory data is looked up automatically, so there is never a reason to call this command twice for advisories. vulnerabilitySource names the Package Manager host that served them and when it answered. When there are no packages to report, an object with available: false and a reason of \'disabled\', \'no-session\', \'session-not-ready\', \'unsupported\', or \'failed\' -- the last of which also carries a message.',
	},
});
