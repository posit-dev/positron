/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { appendPositronGalleryParams, formatPositronVersion, isP3MGalleryUrl } from '../../common/positronGalleryTelemetry.js';

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
			const result = appendPositronGalleryParams(baseUrl, undefined, 'desktop', '2026.06.0-42', true);
			expect(result).toBe(`${baseUrl}?positron-session-type=desktop&positron-version=2026.06.0-42`);
		});

		it('includes check-trigger when provided', () => {
			const result = appendPositronGalleryParams(baseUrl, 'startup', 'desktop', '2026.06.0-42', true);
			expect(result).toBe(`${baseUrl}?positron-check-trigger=startup&positron-session-type=desktop&positron-version=2026.06.0-42`);
		});

		it('uses & separator when URL already has a query string', () => {
			const result = appendPositronGalleryParams(`${baseUrl}?foo=1`, 'periodic', 'workbench', '2026.06.0-42', true);
			expect(result).toBe(`${baseUrl}?foo=1&positron-check-trigger=periodic&positron-session-type=workbench&positron-version=2026.06.0-42`);
		});

		it('encodes special characters in version', () => {
			const result = appendPositronGalleryParams(baseUrl, 'positron-updated', 'positron-server', '2026.06.0+dev', true);
			expect(result).toContain('positron-version=2026.06.0%2Bdev');
		});

		it('emits every session-type value without alteration', () => {
			for (const sessionType of ['desktop', 'workbench', 'workbench-server', 'positron-server', 'remote-server'] as const) {
				const result = appendPositronGalleryParams(baseUrl, undefined, sessionType, '2026.06.0', true);
				expect(result).toContain(`positron-session-type=${sessionType}`);
			}
		});

		it('returns the URL unchanged for non-P3M galleries', () => {
			const openVsx = 'https://open-vsx.org/vscode/gallery/extensionquery';
			expect(appendPositronGalleryParams(openVsx, 'startup', 'desktop', '2026.06.0', true)).toBe(openVsx);

			const internal = 'https://gallery.internal.example.com/extensionquery';
			expect(appendPositronGalleryParams(internal, 'periodic', 'workbench', '2026.06.0', true)).toBe(internal);
		});

		it('tags P3M subdomains (e.g. staging)', () => {
			const staging = 'https://staging.p3m.dev/openvsx/latest/vscode/gallery/extensionquery';
			const result = appendPositronGalleryParams(staging, 'startup', 'desktop', '2026.06.0', true);
			expect(result).toContain('positron-check-trigger=startup');
		});

		it('does not tag URLs that merely contain p3m.dev as substring', () => {
			const spoof = 'https://p3m.dev.attacker.com/extensionquery';
			expect(appendPositronGalleryParams(spoof, 'startup', 'desktop', '2026.06.0', true)).toBe(spoof);
		});

		it('tolerates URI template placeholders in the path', () => {
			const template = 'https://p3m.dev/openvsx/latest/vscode/gallery/{publisher}/{name}/latest';
			const result = appendPositronGalleryParams(template, 'startup', 'desktop', '2026.06.0', true);
			expect(result).toContain('positron-check-trigger=startup');
		});

		it('returns the URL unchanged when sendUsageData is false', () => {
			const result = appendPositronGalleryParams(baseUrl, 'startup', 'desktop', '2026.06.0', false);
			expect(result).toBe(baseUrl);
		});

		it('respects sendUsageData=false even on a P3M URL with a trigger', () => {
			const result = appendPositronGalleryParams(baseUrl, 'periodic', 'workbench-server', '2026.06.0-42', false);
			expect(result).toBe(baseUrl);
		});
	});

	describe('isP3MGalleryUrl', function () {
		it('matches p3m.dev exactly', () => {
			expect(isP3MGalleryUrl('https://p3m.dev/openvsx/latest/vscode/gallery/extensionquery')).toBe(true);
		});

		it('matches p3m.dev subdomains', () => {
			expect(isP3MGalleryUrl('https://staging.p3m.dev/foo')).toBe(true);
		});

		it('rejects unrelated hosts', () => {
			expect(isP3MGalleryUrl('https://open-vsx.org/vscode/gallery/extensionquery')).toBe(false);
			expect(isP3MGalleryUrl('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery')).toBe(false);
		});

		it('rejects substring collisions', () => {
			expect(isP3MGalleryUrl('https://p3m.dev.attacker.com/foo')).toBe(false);
		});

		it('returns false for malformed URLs', () => {
			expect(isP3MGalleryUrl('not a url')).toBe(false);
			expect(isP3MGalleryUrl('')).toBe(false);
		});
	});
});
