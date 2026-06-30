/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { interpretProbeResult, WarnOnceCache, buildProbeQueryBody, redactUrlForDisplay } from '../../common/positronCustomGalleryProbe.js';

describe('interpretProbeResult', () => {
	it('notifies for an invalid URL', () => {
		expect(interpretProbeResult({ kind: 'invalid-url' }).notify).toBe(true);
	});

	it('does not notify on 2xx with a results array', () => {
		expect(interpretProbeResult({ kind: 'http', status: 200, hasResultsArray: true }).notify).toBe(false);
	});

	it('notifies on 2xx without a results array', () => {
		expect(interpretProbeResult({ kind: 'http', status: 200, hasResultsArray: false }).notify).toBe(true);
	});

	it('notifies on a non-2xx status, including the status', () => {
		const result = interpretProbeResult({ kind: 'http', status: 404, hasResultsArray: false });
		expect(result.notify).toBe(true);
		expect(result.notify && result.reason).toContain('404');
	});

	it('notifies on a network error with the reason', () => {
		const result = interpretProbeResult({ kind: 'error', reason: 'timed out' });
		expect(result.notify).toBe(true);
		expect(result.notify && result.reason).toBe('timed out');
	});

	it('does not notify at the 2xx boundary (299) with a results array', () => {
		expect(interpretProbeResult({ kind: 'http', status: 299, hasResultsArray: true }).notify).toBe(false);
	});

	it('notifies for a status just below 2xx (199)', () => {
		expect(interpretProbeResult({ kind: 'http', status: 199, hasResultsArray: true }).notify).toBe(true);
	});
});

describe('WarnOnceCache', () => {
	it('warns the first time a failing value is seen, then suppresses repeats', () => {
		const cache = new WarnOnceCache();
		expect(cache.shouldWarn('https://a.example.com')).toBe(true);
		expect(cache.shouldWarn('https://a.example.com')).toBe(false);
	});

	it('warns again when the value changes', () => {
		const cache = new WarnOnceCache();
		expect(cache.shouldWarn('https://a.example.com')).toBe(true);
		expect(cache.shouldWarn('https://b.example.com')).toBe(true);
	});

	it('clears the cache so a previously-warned value warns again', () => {
		const cache = new WarnOnceCache();
		expect(cache.shouldWarn('https://a.example.com')).toBe(true);
		cache.clear();
		expect(cache.shouldWarn('https://a.example.com')).toBe(true);
	});
});

describe('buildProbeQueryBody', () => {
	it('builds a minimal single-result extension query', () => {
		const body = buildProbeQueryBody();
		expect(Array.isArray(body.filters)).toBe(true);
		expect(body.filters[0].pageSize).toBe(1);
	});
});

describe('redactUrlForDisplay', () => {
	it('strips credentials from a URL', () => {
		expect(redactUrlForDisplay('https://user:pass@host.example.com/vscode')).toBe('https://host.example.com/vscode');
	});

	it('leaves a credential-free URL unchanged (trailing slash stripped)', () => {
		expect(redactUrlForDisplay('https://host.example.com/vscode')).toBe('https://host.example.com/vscode');
	});

	it('returns unparseable input trimmed as-is (cannot contain URL credentials)', () => {
		expect(redactUrlForDisplay('  not a url  ')).toBe('not a url');
	});

	it('strips a trailing slash on the root path', () => {
		expect(redactUrlForDisplay('https://host.example.com/')).toBe('https://host.example.com');
	});

	it('strips query and fragment, which may carry tokens', () => {
		expect(redactUrlForDisplay('https://host.example.com/vscode?token=secret#frag')).toBe('https://host.example.com/vscode');
	});
});
