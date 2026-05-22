/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { appendPositronGalleryParams, formatPositronVersion } from '../../common/positronGalleryTelemetry.js';

describe('positronGalleryTelemetry', function () {
	describe('formatPositronVersion', function () {
		it('appends build number when greater than zero', () => {
			expect(formatPositronVersion('2026.06.0', 42)).toBe('2026.06.0-42');
		});

		it('omits build number when zero', () => {
			expect(formatPositronVersion('2026.06.0', 0)).toBe('2026.06.0');
		});
	});

	describe('appendPositronGalleryParams', function () {
		const baseUrl = 'https://p3m.dev/openvsx/latest/vscode/gallery/extensionquery';

		it('always appends session-type and version', () => {
			const result = appendPositronGalleryParams(baseUrl, undefined, 'desktop', '2026.06.0-42');
			expect(result).toBe(`${baseUrl}?positron-session-type=desktop&positron-version=2026.06.0-42`);
		});

		it('includes check-trigger when provided', () => {
			const result = appendPositronGalleryParams(baseUrl, 'startup', 'desktop', '2026.06.0-42');
			expect(result).toBe(`${baseUrl}?positron-check-trigger=startup&positron-session-type=desktop&positron-version=2026.06.0-42`);
		});

		it('uses & separator when URL already has a query string', () => {
			const result = appendPositronGalleryParams(`${baseUrl}?foo=1`, 'periodic', 'workbench', '2026.06.0-42');
			expect(result).toBe(`${baseUrl}?foo=1&positron-check-trigger=periodic&positron-session-type=workbench&positron-version=2026.06.0-42`);
		});

		it('encodes special characters in version', () => {
			const result = appendPositronGalleryParams(baseUrl, 'positron-updated', 'positron-server', '2026.06.0+dev');
			expect(result).toContain('positron-version=2026.06.0%2Bdev');
		});

		it('emits every session-type value without alteration', () => {
			for (const sessionType of ['desktop', 'workbench', 'workbench-server', 'positron-server', 'remote-server'] as const) {
				const result = appendPositronGalleryParams(baseUrl, undefined, sessionType, '2026.06.0');
				expect(result).toContain(`positron-session-type=${sessionType}`);
			}
		});
	});
});
