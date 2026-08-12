/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IPackageVulnerability } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * Setting key: when `false`, the language runtimes skip the PPM vulnerability
 * lookup entirely (no network call, no advisory data) and the pane renders no
 * vulnerability indicators. Bare key per Positron configuration conventions.
 */
export const PACKAGES_VULNERABILITIES_ENABLED_SETTING = 'packages.vulnerabilities.enabled';

/**
 * NVD severity band for a CVSS base score, plus 'unscored' for advisories that
 * carry no score at all (the common case for CRAN's RSEC advisories).
 * Bands follow https://nvd.nist.gov/vuln-metrics/cvss:
 * Critical 9.0-10.0, High 7.0-8.9, Medium 4.0-6.9, Low 0.0-3.9.
 */
export type VulnerabilitySeverityBand = 'critical' | 'high' | 'medium' | 'low' | 'unscored';

/**
 * Maps a CVSS base score to its NVD severity band. An undefined score is
 * 'unscored': known-vulnerable, severity unknown.
 */
export function severityBand(score: number | undefined): VulnerabilitySeverityBand {
	if (score === undefined) {
		return 'unscored';
	}
	if (score >= 9.0) {
		return 'critical';
	}
	if (score >= 7.0) {
		return 'high';
	}
	if (score >= 4.0) {
		return 'medium';
	}
	return 'low';
}

/**
 * Localized display label for a severity band.
 */
export function severityBandLabel(band: VulnerabilitySeverityBand): string {
	switch (band) {
		case 'critical':
			return localize('positron.packages.severity.critical', "Critical");
		case 'high':
			return localize('positron.packages.severity.high', "High");
		case 'medium':
			return localize('positron.packages.severity.medium', "Medium");
		case 'low':
			return localize('positron.packages.severity.low', "Low");
		case 'unscored':
			return localize('positron.packages.severity.unscored', "Severity unknown");
	}
}

/**
 * The maximum CVSS base score across a package's advisories, or undefined when
 * none of them carries a score.
 */
export function maxVulnerabilityScore(vulnerabilities: readonly IPackageVulnerability[]): number | undefined {
	let max: number | undefined;
	for (const vulnerability of vulnerabilities) {
		if (vulnerability.score !== undefined && (max === undefined || vulnerability.score > max)) {
			max = vulnerability.score;
		}
	}
	return max;
}

/**
 * The advisory to lead with in compact UI: the highest-scored one, falling
 * back to the first advisory when none carries a score.
 */
export function worstVulnerability(vulnerabilities: readonly IPackageVulnerability[]): IPackageVulnerability | undefined {
	if (vulnerabilities.length === 0) {
		return undefined;
	}
	let worst = vulnerabilities[0];
	for (const vulnerability of vulnerabilities) {
		if (vulnerability.score !== undefined && (worst.score === undefined || vulnerability.score > worst.score)) {
			worst = vulnerability;
		}
	}
	return worst;
}
