/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { computeDeploymentPrefix } from '../../node/pwbConstants.js';

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
