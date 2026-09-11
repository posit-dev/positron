/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { computeDeploymentPrefix } from '../../node/pwbConstants.js';
import { shouldUseSessionLessStaticCallbackRoute, shouldUseSessionLessStaticRoute } from '../../node/positronStaticRoute.js';

describe('PWB computeDeploymentPrefix', () => {

	it('empty when RS_SESSION_URL is unset', () => {
		expect(computeDeploymentPrefix(undefined)).toBe('');
		expect(computeDeploymentPrefix('')).toBe('');
	});

	it('empty when Workbench is mounted at the origin root', () => {
		expect(computeDeploymentPrefix('/s/a0b7e3c9ab5a7e6d5aeef/')).toBe('');
	});

	it('returns the sub-path a front proxy routes to Workbench', () => {
		expect(computeDeploymentPrefix('/rstudio/s/a0b7e3c9ab5a7e6d5aeef/')).toBe('/rstudio');
		expect(computeDeploymentPrefix('/a/b/s/a0b7e3c9ab5a7e6d5aeef/')).toBe('/a/b');
	});

	it('drops scheme and host from a fully qualified session URL', () => {
		expect(computeDeploymentPrefix('https://helio.local/s/a0b7e3c9ab5a7e6d5aeef/')).toBe('');
		expect(computeDeploymentPrefix('http://helio.local:8787/s/a0b7e3c9ab5a7e6d5aeef/')).toBe('');
		expect(computeDeploymentPrefix('https://helio.local/rstudio/s/a0b7e3c9ab5a7e6d5aeef/')).toBe('/rstudio');
	});

	it('drops the host from a protocol-relative session URL', () => {
		// Shape seen from rserver's /api/launch_session path (rstudio-pro double-prefixes the
		// session URL there, which lands in RS_SESSION_URL as "//<host>/s/<session-id>/").
		expect(computeDeploymentPrefix('//helio.local/s/d5de83c9ab5a7b6ea23ae/')).toBe('');
		expect(computeDeploymentPrefix('//helio.local/rstudio/s/d5de83c9ab5a7b6ea23ae/')).toBe('/rstudio');
	});

	it('never returns something that is not a rooted path', () => {
		// A bare host with no scheme would otherwise be mistaken for a path prefix.
		expect(computeDeploymentPrefix('helio.local/s/a0b7e3c9ab5a7e6d5aeef/')).toBe('');
		expect(computeDeploymentPrefix('https://helio.local')).toBe('');
		expect(computeDeploymentPrefix('not-a-session-url')).toBe('');
	});
});

type PwbConstantsModule = typeof import('../../node/pwbConstants.js');

async function withSessionUrl<T>(sessionUrl: string | undefined, fn: (constants: PwbConstantsModule) => T | Promise<T>): Promise<T> {
	const original = process.env['RS_SESSION_URL'];
	if (sessionUrl === undefined) {
		delete process.env['RS_SESSION_URL'];
	} else {
		process.env['RS_SESSION_URL'] = sessionUrl;
	}
	vi.resetModules();
	try {
		return await fn(await import('../../node/pwbConstants.js'));
	} finally {
		if (original === undefined) {
			delete process.env['RS_SESSION_URL'];
		} else {
			process.env['RS_SESSION_URL'] = original;
		}
		vi.resetModules();
	}
}

describe('resolveSessionlessStaticCallbackRoute', () => {
	it('uses the existing sessionless static route with a stable callback segment', async () => {
		await withSessionUrl(undefined, constants => {
			expect(constants.resolveSessionlessStaticCallbackRoute())
				.toBe('/positron-static/callback-0/static/out/vs/code/browser/workbench/callback.html');
		});
	});

	it('keeps the Workbench deployment prefix', async () => {
		await withSessionUrl('/rstudio/s/8791a6ae9dc1b037e055c/', constants => {
			expect(constants.resolveSessionlessStaticCallbackRoute())
				.toBe('/rstudio/positron-static/callback-0/static/out/vs/code/browser/workbench/callback.html');
		});
	});

	it('does not include the Workbench session id', async () => {
		const first = await withSessionUrl('/s/aaaaaaaaaaaaaaaaaaaaa/', constants => constants.resolveSessionlessStaticCallbackRoute());
		const second = await withSessionUrl('/s/bbbbbbbbbbbbbbbbbbbbb/', constants => constants.resolveSessionlessStaticCallbackRoute());

		expect({ first, second }).toEqual({
			first: '/positron-static/callback-0/static/out/vs/code/browser/workbench/callback.html',
			second: '/positron-static/callback-0/static/out/vs/code/browser/workbench/callback.html'
		});
	});
});

describe('sessionless static route gates', () => {
	it('uses the static callback route for Workbench when the route is available', () => {
		expect(shouldUseSessionLessStaticCallbackRoute(true, true)).toBe(true);
		expect(shouldUseSessionLessStaticCallbackRoute(true, false)).toBe(false);
		expect(shouldUseSessionLessStaticCallbackRoute(false, true)).toBe(false);
	});

	it('keeps the daily-build exception scoped to cacheable assets', () => {
		expect({
			callback: shouldUseSessionLessStaticCallbackRoute(true, true),
			asset: shouldUseSessionLessStaticRoute(true, true, 'dailies')
		}).toEqual({
			callback: true,
			asset: false
		});
	});
});
