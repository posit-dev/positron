/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Identifies the kind of compute environment a remote SSH host is, so that
 * downloading the remote extension host into a managed compute platform can be
 * recognized.
 *
 * The verdict is reported as an `ssh-env` query parameter on the REH download
 * URL, which Positron's CDN logs and which is processed outside this codebase.
 * That mirrors how the update check reports usage (`buildUpdateUrl` in
 * `src/vs/platform/update/common/positronUpdateUtils.ts`); this file cannot
 * reuse it because extensions cannot import from `src/vs`.
 */

/** The Posit-hosted CDN hosts that may receive an `ssh-env` parameter. */
const POSIT_CDN_HOSTS = ['cdn.posit.co'];

/**
 * Environment variables probed on the remote host. Only the *presence* of each
 * is ever read: some carry secrets (`DATABRICKS_TOKEN`) or identify a specific
 * cluster (`DATABRICKS_CLUSTER_ID`), and neither is needed to tell what kind of
 * environment this is.
 */
export const PROBED_ENV_VARS = [
	// Set on every node of a Databricks cluster by the runtime itself.
	'DATABRICKS_RUNTIME_VERSION',
	'DATABRICKS_CLUSTER_ID',
	'DATABRICKS_REMOTE_ENV',
	// Set by rserver when it spawns a server, i.e. this host is Posit Workbench.
	'RS_SERVER_URL',
] as const;

/**
 * A recognized compute environment, used as the `ssh-env` parameter value.
 * Hosts that match nothing report no parameter at all rather than a catch-all
 * value, so the CDN logs stay a record of positive identifications.
 */
export type SshEnvironment = 'databricks';

/**
 * Environment variables that positively identify a host, in priority order.
 *
 * Deliberately excluded: `DATABRICKS_HOST` and `DATABRICKS_TOKEN`. Those are
 * client credentials for talking *to* Databricks, and are what Posit Workbench
 * sets for a user connecting to a warehouse from elsewhere. Treating them as a
 * signal would report every such user as running inside Databricks compute.
 */
const ENVIRONMENT_SIGNALS: ReadonlyArray<readonly [SshEnvironment, readonly string[]]> = [
	['databricks', ['DATABRICKS_RUNTIME_VERSION', 'DATABRICKS_CLUSTER_ID', 'DATABRICKS_REMOTE_ENV']],
];

/**
 * Variables whose presence suppresses any verdict. A host running Posit
 * Workbench is an expected deployment even when it also carries the markers of
 * the platform it is running on, so it is never reported.
 */
const EXCLUSION_SIGNALS = ['RS_SERVER_URL'];

/**
 * Classifies a remote host from the environment variables it has set.
 *
 * @param setVariables Names of the probed variables that are set and non-empty
 * on the remote host.
 * @returns The identified environment, or undefined if the host matches nothing
 * or is excluded.
 */
export function detectSshEnvironment(setVariables: readonly string[]): SshEnvironment | undefined {
	const present = new Set(setVariables);
	if (EXCLUSION_SIGNALS.some(variable => present.has(variable))) {
		return undefined;
	}
	for (const [environment, signals] of ENVIRONMENT_SIGNALS) {
		if (signals.some(signal => present.has(signal))) {
			return environment;
		}
	}
	return undefined;
}

/** Marks a probe output line, so unrelated shell profile chatter is ignored. */
const PROBE_PREFIX = 'ssh-env-set:';

/**
 * Builds the shell command that reports which probed variables are set on the
 * remote host. Emits only names, never values.
 *
 * Kept POSIX-compatible (no `bash`-only indirection) because it runs before the
 * remote's platform and shell have been determined.
 */
export function buildEnvironmentProbeCommand(variables: readonly string[] = PROBED_ENV_VARS): string {
	return variables
		.map(variable => `[ -n "$${variable}" ] && echo "${PROBE_PREFIX}${variable}"`)
		.join('; ');
}

/**
 * Extracts the set variable names from the probe's output.
 *
 * @param stdout Raw stdout from the probe command.
 * @returns The names of the probed variables reported as set.
 */
export function parseEnvironmentProbeOutput(stdout: string): string[] {
	const names = new Set<string>();
	for (const line of stdout.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith(PROBE_PREFIX)) {
			const name = trimmed.slice(PROBE_PREFIX.length);
			// Only echo back variables we asked about; a host cannot inject others.
			if ((PROBED_ENV_VARS as readonly string[]).includes(name)) {
				names.add(name);
			}
		}
	}
	return [...names];
}

/**
 * Whether a download URL points at a Posit-hosted CDN.
 *
 * The template is user-overridable (`remoteSSH.serverDownloadUrlTemplate`), so
 * a host that is not ours must never receive the parameter. Parsed with a regex
 * rather than `URL`, because the template still contains `${...}` placeholders
 * that `URL` would percent-encode.
 */
export function isPositCdnUrl(url: string): boolean {
	const host = /^https?:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase();
	if (!host) {
		return false;
	}
	// Strip any port and userinfo before comparing.
	const hostname = host.split('@').pop()!.split(':')[0];
	return POSIT_CDN_HOSTS.includes(hostname);
}

/**
 * Appends the `ssh-env` parameter to a REH download URL template.
 *
 * Built by string concatenation, matching `buildUpdateUrl`, and because `URL`
 * would mangle the `${quality}` / `${os}` placeholders the remote install
 * script substitutes later.
 *
 * @param urlTemplate The REH download URL template.
 * @param environment The identified environment, or undefined to leave the
 * template unchanged.
 * @returns The template, with the parameter appended when applicable.
 */
export function appendSshEnvironmentParam(urlTemplate: string, environment: SshEnvironment | undefined): string {
	if (!environment || !isPositCdnUrl(urlTemplate)) {
		return urlTemplate;
	}
	const separator = urlTemplate.includes('?') ? '&' : '?';
	return `${urlTemplate}${separator}ssh-env=${environment}`;
}
