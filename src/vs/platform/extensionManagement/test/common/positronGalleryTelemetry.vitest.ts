/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { appendPositronGalleryParams, formatPositronVersion, isP3MGalleryUrl } from '../../common/positronGalleryTelemetry.js';

/** Path to the platform module as resolved from this test file. */
const PLATFORM_MODULE = '../../../../base/common/platform.js';
type PlatformModule = typeof import('../../../../base/common/platform.js');

/**
 * Resolves the session type under a given deployment shape. The platform flags and the SageMaker
 * flag are all captured when their modules first load, so each case re-imports rather than
 * mutating modules already in memory. `workbench` goes through the real `RS_SERVER_URL`
 * derivation; `platform` overrides the flags Node cannot produce on its own.
 */
async function loadSessionType(options: {
	workbench?: boolean;
	sageMaker?: boolean;
	platform?: Partial<PlatformModule>;
} = {}): Promise<string> {
	const previousServerUrl = process.env.RS_SERVER_URL;
	if (options.workbench) {
		process.env.RS_SERVER_URL = 'https://workbench.example.com';
	} else {
		delete process.env.RS_SERVER_URL;
	}
	try {
		vi.resetModules();
		vi.doUnmock(PLATFORM_MODULE);
		const overrides = options.platform;
		if (overrides) {
			// Spread the real module so only the named flags change; a bare object would turn
			// every other export into `undefined`.
			vi.doMock(PLATFORM_MODULE, async importOriginal => ({
				...await importOriginal<PlatformModule>(),
				...overrides,
			}));
		}
		if (options.sageMaker) {
			const session = await import('../../../positronLicense/common/positronSageMakerSession.js');
			session.markSageMakerSession();
		}
		const { getPositronSessionType } = await import('../../common/positronGalleryTelemetry.js');
		return getPositronSessionType();
	} finally {
		if (previousServerUrl === undefined) {
			delete process.env.RS_SERVER_URL;
		} else {
			process.env.RS_SERVER_URL = previousServerUrl;
		}
	}
}
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

		it('always appends session-type, version, and is-academic', () => {
			const result = appendPositronGalleryParams(baseUrl, undefined, 'desktop', '2026.06.0-42', true, true);
			expect(result).toBe(`${baseUrl}?positron-session-type=desktop&positron-version=2026.06.0-42&positron-is-academic=true`);
		});

		it('includes check-trigger when provided', () => {
			const result = appendPositronGalleryParams(baseUrl, 'startup', 'desktop', '2026.06.0-42', true, true);
			expect(result).toBe(`${baseUrl}?positron-check-trigger=startup&positron-session-type=desktop&positron-version=2026.06.0-42&positron-is-academic=true`);
		});

		it('uses & separator when URL already has a query string', () => {
			const result = appendPositronGalleryParams(`${baseUrl}?foo=1`, 'periodic', 'workbench', '2026.06.0-42', true, true);
			expect(result).toBe(`${baseUrl}?foo=1&positron-check-trigger=periodic&positron-session-type=workbench&positron-version=2026.06.0-42&positron-is-academic=true`);
		});

		it('encodes special characters in version', () => {
			const result = appendPositronGalleryParams(baseUrl, 'positron-updated', 'positron-server', '2026.06.0+dev', true, true);
			expect(result).toContain('positron-version=2026.06.0%2Bdev');
		});

		it('emits every session-type value without alteration', () => {
			for (const sessionType of ['desktop', 'workbench', 'workbench-server', 'positron-server', 'positron-sagemaker', 'remote-server'] as const) {
				const result = appendPositronGalleryParams(baseUrl, undefined, sessionType, '2026.06.0', true, true);
				expect(result).toContain(`positron-session-type=${sessionType}`);
			}
		});

		it('appends positron-is-academic=false when the session is not academic', () => {
			const result = appendPositronGalleryParams(baseUrl, undefined, 'positron-server', '2026.06.0', false, true);
			expect(result).toContain('positron-is-academic=false');
		});

		it('returns the URL unchanged for non-P3M galleries', () => {
			const openVsx = 'https://open-vsx.org/vscode/gallery/extensionquery';
			expect(appendPositronGalleryParams(openVsx, 'startup', 'desktop', '2026.06.0', true, true)).toBe(openVsx);

			const internal = 'https://gallery.internal.example.com/extensionquery';
			expect(appendPositronGalleryParams(internal, 'periodic', 'workbench', '2026.06.0', true, true)).toBe(internal);
		});

		it('tags P3M subdomains (e.g. staging)', () => {
			const staging = 'https://staging.p3m.dev/openvsx/latest/vscode/gallery/extensionquery';
			const result = appendPositronGalleryParams(staging, 'startup', 'desktop', '2026.06.0', true, true);
			expect(result).toContain('positron-check-trigger=startup');
		});

		it('does not tag URLs that merely contain p3m.dev as substring', () => {
			const spoof = 'https://p3m.dev.attacker.com/extensionquery';
			expect(appendPositronGalleryParams(spoof, 'startup', 'desktop', '2026.06.0', true, true)).toBe(spoof);
		});

		it('tolerates URI template placeholders in the path', () => {
			const template = 'https://p3m.dev/openvsx/latest/vscode/gallery/{publisher}/{name}/latest';
			const result = appendPositronGalleryParams(template, 'startup', 'desktop', '2026.06.0', true, true);
			expect(result).toContain('positron-check-trigger=startup');
		});

		it('returns the URL unchanged when sendUsageData is false', () => {
			const result = appendPositronGalleryParams(baseUrl, 'startup', 'desktop', '2026.06.0', true, false);
			expect(result).toBe(baseUrl);
		});

		it('respects sendUsageData=false even on a P3M URL with a trigger', () => {
			const result = appendPositronGalleryParams(baseUrl, 'periodic', 'workbench-server', '2026.06.0-42', true, false);
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

	describe('getPositronSessionType', function () {
		it('reports a desktop build as desktop', async () => {
			expect(await loadSessionType({ platform: { isElectron: true } })).toBe('desktop');
		});

		it('reports an unmarked Node backend as remote-server', async () => {
			expect(await loadSessionType()).toBe('remote-server');
		});

		it('reports an unmarked browser tab as positron-server', async () => {
			expect(await loadSessionType({ platform: { isWeb: true } })).toBe('positron-server');
		});

		it('reports a SageMaker-licensed Node backend as positron-sagemaker', async () => {
			expect(await loadSessionType({ sageMaker: true })).toBe('positron-sagemaker');
		});

		it('reports a SageMaker browser tab as positron-sagemaker too', async () => {
			const globals = globalThis as Record<string, unknown>;
			globals['_POSITRON_IS_SAGEMAKER'] = true;
			try {
				expect(await loadSessionType({ platform: { isWeb: true } })).toBe('positron-sagemaker');
			} finally {
				delete globals['_POSITRON_IS_SAGEMAKER'];
			}
		});

		it('prefers the Workbench label over SageMaker', async () => {
			expect(await loadSessionType({ workbench: true, sageMaker: true })).toBe('workbench-server');
		});
	});
});
