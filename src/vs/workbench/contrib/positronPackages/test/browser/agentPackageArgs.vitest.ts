/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { normalizeAgentTargetVersion } from '../../browser/agentPackageArgs.js';

describe('normalizeAgentTargetVersion', () => {
	it('maps the agent version contract onto the packages-service version contract', () => {
		expect({
			latest: normalizeAgentTargetVersion('latest'),
			explicit: normalizeAgentTargetVersion('1.2.3'),
			missing: normalizeAgentTargetVersion(undefined),
		}).toEqual({ latest: undefined, explicit: '1.2.3', missing: undefined });
	});
});
