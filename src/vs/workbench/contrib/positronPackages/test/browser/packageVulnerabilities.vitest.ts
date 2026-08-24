/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IPackageVulnerability } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { maxVulnerabilityScore, severityBand, worstVulnerability } from '../../browser/packageVulnerabilities.js';

const vuln = (overrides: Partial<IPackageVulnerability> = {}): IPackageVulnerability => ({
	id: 'CVE-2024-0001',
	osvId: 'GHSA-xxxx-yyyy-zzzz',
	...overrides,
});

describe('packageVulnerabilities', () => {

	ensureNoLeakedDisposables();

	describe('severityBand', () => {
		it('maps scores to NVD bands at the band boundaries', () => {
			expect(severityBand(10.0)).toBe('critical');
			expect(severityBand(9.0)).toBe('critical');
			expect(severityBand(8.9)).toBe('high');
			expect(severityBand(7.0)).toBe('high');
			expect(severityBand(6.9)).toBe('medium');
			expect(severityBand(4.0)).toBe('medium');
			expect(severityBand(3.9)).toBe('low');
			expect(severityBand(0)).toBe('low');
		});

		it('maps a missing score to unscored', () => {
			expect(severityBand(undefined)).toBe('unscored');
		});
	});

	describe('maxVulnerabilityScore', () => {
		it('returns the highest score across advisories', () => {
			const vulnerabilities = [vuln({ score: 5.5 }), vuln({ score: 9.8 }), vuln({ score: 7.5 })];
			expect(maxVulnerabilityScore(vulnerabilities)).toBe(9.8);
		});

		it('ignores unscored advisories when scored ones exist', () => {
			const vulnerabilities = [vuln({ score: undefined }), vuln({ score: 4.4 })];
			expect(maxVulnerabilityScore(vulnerabilities)).toBe(4.4);
		});

		it('returns undefined when nothing carries a score', () => {
			expect(maxVulnerabilityScore([vuln(), vuln()])).toBeUndefined();
			expect(maxVulnerabilityScore([])).toBeUndefined();
		});
	});

	describe('worstVulnerability', () => {
		it('returns the highest-scored advisory', () => {
			const highest = vuln({ id: 'CVE-2024-0002', score: 9.8 });
			expect(worstVulnerability([vuln({ score: 5.5 }), highest, vuln()])).toBe(highest);
		});

		it('falls back to the first advisory when none carries a score', () => {
			const first = vuln({ id: 'RSEC-2023-6' });
			expect(worstVulnerability([first, vuln({ id: 'RSEC-2023-7' })])).toBe(first);
		});

		it('returns undefined for an empty list', () => {
			expect(worstVulnerability([])).toBeUndefined();
		});
	});
});
