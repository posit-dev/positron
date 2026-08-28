/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { appendPositronGalleryParams, formatPositronVersion, isP3MGalleryUrl, PositronCheckTrigger, PositronSessionType } from '../../common/positronGalleryTelemetry.js';

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

		/**
		 * Calls `appendPositronGalleryParams` by name. The real signature is positional and
		 * ends in two booleans plus an optional hash, which at a call site reads as a row of
		 * bare literals; naming them keeps each test to the one field it is about.
		 */
		function appendParams(overrides: {
			url?: string;
			checkTrigger?: PositronCheckTrigger;
			sessionType?: PositronSessionType;
			version?: string;
			isAcademic?: boolean;
			licenseHash?: string;
			sendUsageData?: boolean;
		} = {}): string {
			const args = {
				url: baseUrl,
				sessionType: 'desktop' as PositronSessionType,
				version: '2026.06.0-42',
				isAcademic: true,
				sendUsageData: true,
				...overrides,
			};
			return appendPositronGalleryParams(args.url, args.checkTrigger, args.sessionType, args.version, args.isAcademic, args.licenseHash, args.sendUsageData);
		}

		it('always appends session-type, version, and is-academic', () => {
			expect(appendParams()).toBe(`${baseUrl}?positron-session-type=desktop&positron-version=2026.06.0-42&positron-is-academic=true`);
		});

		it('includes check-trigger when provided', () => {
			expect(appendParams({ checkTrigger: 'startup' })).toBe(`${baseUrl}?positron-check-trigger=startup&positron-session-type=desktop&positron-version=2026.06.0-42&positron-is-academic=true`);
		});

		it('uses & separator when URL already has a query string', () => {
			expect(appendParams({ url: `${baseUrl}?foo=1`, checkTrigger: 'periodic', sessionType: 'workbench' }))
				.toBe(`${baseUrl}?foo=1&positron-check-trigger=periodic&positron-session-type=workbench&positron-version=2026.06.0-42&positron-is-academic=true`);
		});

		it('encodes special characters in version', () => {
			expect(appendParams({ version: '2026.06.0+dev' })).toContain('positron-version=2026.06.0%2Bdev');
		});

		it.each(['desktop', 'workbench', 'workbench-server', 'positron-server', 'positron-sagemaker', 'positron-sagemaker-server', 'remote-server'] as const)(
			'emits session-type %s without alteration',
			sessionType => {
				expect(appendParams({ sessionType })).toContain(`positron-session-type=${sessionType}`);
			});

		it('appends positron-is-academic=false when the session is not academic', () => {
			expect(appendParams({ isAcademic: false })).toContain('positron-is-academic=false');
		});

		it('appends the license hash after is-academic when the session has one', () => {
			expect(appendParams({ checkTrigger: 'startup', licenseHash: 'a1b2c3d4e5f60718' }))
				.toBe(`${baseUrl}?positron-check-trigger=startup&positron-session-type=desktop&positron-version=2026.06.0-42&positron-is-academic=true&positron-license-hash=a1b2c3d4e5f60718`);
		});

		it('omits the license hash param rather than sending it empty', () => {
			// The param is gated on the hash being truthy, not merely defined, so a license
			// path that produced an empty string reports nothing at all.
			expect(appendParams({ licenseHash: '' })).not.toContain('positron-license-hash');
		});

		it('encodes a license hash that is not a plain hex digest', () => {
			// The browser reads the hash off an injected global and only checks that it is a
			// string, so an unexpected value must not be able to add params of its own.
			expect(appendParams({ licenseHash: 'a b&c=d' })).toContain('positron-license-hash=a%20b%26c%3Dd');
		});

		it('suppresses the license hash when sendUsageData is false', () => {
			// Redundant with the opt-out tests below, since the opt-out returns before any
			// param is built; kept to state the privacy contract for the most identifying
			// param explicitly.
			expect(appendParams({ checkTrigger: 'startup', licenseHash: 'a1b2c3d4e5f60718', sendUsageData: false })).toBe(baseUrl);
		});

		it('returns the URL unchanged for non-P3M galleries', () => {
			const openVsx = 'https://open-vsx.org/vscode/gallery/extensionquery';
			const internal = 'https://gallery.internal.example.com/extensionquery';
			expect([
				appendParams({ url: openVsx, checkTrigger: 'startup' }),
				appendParams({ url: internal, checkTrigger: 'periodic', sessionType: 'workbench' }),
			]).toEqual([openVsx, internal]);
		});

		it('tags P3M subdomains (e.g. staging)', () => {
			const staging = 'https://staging.p3m.dev/openvsx/latest/vscode/gallery/extensionquery';
			expect(appendParams({ url: staging, checkTrigger: 'startup' })).toContain('positron-check-trigger=startup');
		});

		it('does not tag URLs that merely contain p3m.dev as substring', () => {
			const spoof = 'https://p3m.dev.attacker.com/extensionquery';
			expect(appendParams({ url: spoof, checkTrigger: 'startup' })).toBe(spoof);
		});

		it('tolerates URI template placeholders in the path', () => {
			const template = 'https://p3m.dev/openvsx/latest/vscode/gallery/{publisher}/{name}/latest';
			expect(appendParams({ url: template, checkTrigger: 'startup' })).toContain('positron-check-trigger=startup');
		});

		it('returns the URL unchanged when sendUsageData is false', () => {
			expect(appendParams({ checkTrigger: 'startup', sendUsageData: false })).toBe(baseUrl);
		});

		it('respects sendUsageData=false even on a P3M URL with a trigger', () => {
			expect(appendParams({ checkTrigger: 'periodic', sessionType: 'workbench-server', sendUsageData: false })).toBe(baseUrl);
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

		it('reports a SageMaker-licensed Node backend as positron-sagemaker-server', async () => {
			expect(await loadSessionType({ sageMaker: true })).toBe('positron-sagemaker-server');
		});

		it('reports a SageMaker browser tab as positron-sagemaker', async () => {
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
