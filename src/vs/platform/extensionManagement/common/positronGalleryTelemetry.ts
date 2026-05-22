/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isElectron, isWeb, isWorkbench } from '../../../base/common/platform.js';

/**
 * Setting key for opting out of P3M gallery telemetry. Boolean; defaults to true.
 * Admins (e.g. PWB) can flip it false via the normal settings.json mechanisms to
 * disable Positron-specific query params on extension gallery requests.
 */
export const GalleryUsageDataConfigKey = 'extensions.gallery.sendUsageData';

/**
 * Why a particular gallery request was issued. Only set on update-check requests; left
 * undefined for browse / other gallery traffic so P3M can distinguish the two buckets.
 */
export type PositronCheckTrigger =
	| 'startup'            // First auto-check after LifecyclePhase.Eventually.
	| 'periodic'           // 12h re-fire of the auto-check timer.
	| 'positron-updated'   // Positron itself reported a product update.
	| 'setting-change'     // User changed auto-check or allowed-extensions setting.
	| 'extension-toggled'  // User enabled/disabled an installed extension.
	| 'network-unmetered'; // Connection flipped off-metered; resume checks.

/** Which Positron distribution / process the request is coming from. */
export type PositronSessionType =
	| 'desktop'           // Electron app (user's local machine).
	| 'workbench'         // PWB-hosted Positron, browser tab side.
	| 'workbench-server'  // PWB-hosted Positron, Node backend (RS_SERVER_URL set).
	| 'positron-server'   // Positron Server such as JupyterHub, browser tab side.
	| 'remote-server';    // Non-PWB Node backend: JupyterHub, remote SSH / WSL / dev container backend.

/**
 * Detects which Positron process is making the gallery request.
 *
 * PWB and other PS each split into a client (browser tab) and a server (Node backend)
 * process; both can independently hit the gallery, and we tag them separately so P3M
 * can correlate or count them as needed.
 *
 */
export function getPositronSessionType(): PositronSessionType {
	if (isWorkbench) {
		return isWeb ? 'workbench' : 'workbench-server';
	}
	if (isWeb) {
		return 'positron-server';
	}
	if (!isElectron) {
		return 'remote-server';
	}
	return 'desktop';
}

/**
 * Formats the Positron version for the gallery `positron-version` param. Combines the
 * three-part overlay version with the build number so P3M can distinguish builds within a
 * release. A build number of 0 (dev / local builds) is omitted.
 */
export function formatPositronVersion(positronVersion: string, positronBuildNumber: number): string {
	if (positronBuildNumber && positronBuildNumber > 0) {
		return `${positronVersion}-${positronBuildNumber}`;
	}
	return positronVersion;
}

/**
 * Whether the URL points at a P3M-hosted gallery. We only attach telemetry params to
 * P3M URLs so non-P3M galleries (Open VSX, internal proxies, custom forks) don't
 * receive Positron-specific telemetry they didn't ask for.
 *
 * Matches `p3m.dev` and any subdomain (e.g. `staging.p3m.dev`). Hostname parsing
 * avoids substring-attack collisions like `p3m.dev.attacker.com`.
 */
export function isP3MGalleryUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname;
		return host === 'p3m.dev' || host.endsWith('.p3m.dev');
	} catch {
		return false;
	}
}

/**
 * Appends Positron telemetry params to a gallery request URL.
 *
 * Returns the URL unchanged when any of these gates fail:
 * - `sendUsageData` is false (admin / user opt-out via {@link GalleryUsageDataConfigKey}).
 * - The URL hostname is not a P3M-hosted gallery (see {@link isP3MGalleryUrl}).
 *
 * P3M's log pipeline captures `request_url` and `user_agent` only. URL params are the
 * portable way to surface check-trigger, session-type, and version across desktop
 * (Electron), Positron Server (browser), and Workbench (PWB). Browsers strip
 * `User-Agent` overrides, so a header-based approach would not work uniformly.
 *
 * `checkTrigger` is omitted from the URL when undefined (browse / non-update-check
 * traffic). `positron-session-type` and `positron-version` are always sent.
 */
export function appendPositronGalleryParams(
	url: string,
	checkTrigger: PositronCheckTrigger | undefined,
	sessionType: PositronSessionType,
	positronVersion: string,
	sendUsageData: boolean,
): string {
	if (!sendUsageData || !isP3MGalleryUrl(url)) {
		return url;
	}
	const params: string[] = [];
	if (checkTrigger) {
		params.push(`positron-check-trigger=${encodeURIComponent(checkTrigger)}`);
	}
	params.push(`positron-session-type=${encodeURIComponent(sessionType)}`);
	params.push(`positron-version=${encodeURIComponent(positronVersion)}`);
	const separator = url.includes('?') ? '&' : '?';
	return `${url}${separator}${params.join('&')}`;
}
