/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { computeDeploymentPrefix } from '../../node/pwbConstants.js';

suite('PWB computeDeploymentPrefix', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('empty when RS_SESSION_URL is unset', () => {
		assert.strictEqual(computeDeploymentPrefix(undefined), '');
		assert.strictEqual(computeDeploymentPrefix(''), '');
	});

	test('empty when Workbench is mounted at the origin root', () => {
		assert.strictEqual(computeDeploymentPrefix('/s/a0b7e3c9ab5a7e6d5aeef/'), '');
	});

	test('returns the sub-path a front proxy routes to Workbench', () => {
		assert.strictEqual(computeDeploymentPrefix('/rstudio/s/a0b7e3c9ab5a7e6d5aeef/'), '/rstudio');
		assert.strictEqual(computeDeploymentPrefix('/a/b/s/a0b7e3c9ab5a7e6d5aeef/'), '/a/b');
	});

	test('drops scheme and host from a fully qualified session URL', () => {
		assert.strictEqual(computeDeploymentPrefix('https://helio.local/s/a0b7e3c9ab5a7e6d5aeef/'), '');
		assert.strictEqual(computeDeploymentPrefix('http://helio.local:8787/s/a0b7e3c9ab5a7e6d5aeef/'), '');
		assert.strictEqual(computeDeploymentPrefix('https://helio.local/rstudio/s/a0b7e3c9ab5a7e6d5aeef/'), '/rstudio');
	});

	test('drops the host from a protocol-relative session URL', () => {
		// Shape seen from rserver's /api/launch_session path (rstudio-pro double-prefixes the
		// session URL there, which lands in RS_SESSION_URL as "//<host>/s/<session-id>/").
		assert.strictEqual(computeDeploymentPrefix('//helio.local/s/d5de83c9ab5a7b6ea23ae/'), '');
		assert.strictEqual(computeDeploymentPrefix('//helio.local/rstudio/s/d5de83c9ab5a7b6ea23ae/'), '/rstudio');
	});

	test('never returns something that is not a rooted path', () => {
		// A bare host with no scheme would otherwise be mistaken for a path prefix.
		assert.strictEqual(computeDeploymentPrefix('helio.local/s/a0b7e3c9ab5a7e6d5aeef/'), '');
		assert.strictEqual(computeDeploymentPrefix('https://helio.local'), '');
		assert.strictEqual(computeDeploymentPrefix('not-a-session-url'), '');
	});
});
