/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ExtHostCommands } from '../../../common/extHostCommands.js';
import { IExtHostWorkspace } from '../../../common/extHostWorkspace.js';
import { ExtHostAiFeatures } from '../../../common/positron/extHostAiFeatures.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';

function createFeatures(): ExtHostAiFeatures {
	return new ExtHostAiFeatures(
		SingleProxyRPCProtocol(null),
		stubInterface<ExtHostCommands>(),
		stubInterface<IExtHostWorkspace>(),
	);
}

describe('ExtHostAiFeatures skill roots', () => {
	beforeEach(() => {
		ensureNoLeakedDisposables();
	});

	it('registers a root, exposes it, and fires the change event once', async () => {
		const features = createFeatures();
		let fired = 0;
		const sub = features.onDidChangeAgentSkillRoots(() => fired++);

		const reg = features.registerAgentSkillRoot('/skills');

		expect(await features.getAgentSkillRoots()).toEqual(['/skills']);
		expect(fired).toBe(1);

		// Duplicate registration is a no-op: no second event, still one root.
		features.registerAgentSkillRoot('/skills');
		expect(fired).toBe(1);

		reg.dispose();
		expect(await features.getAgentSkillRoots()).toEqual([]);
		expect(fired).toBe(2);

		sub.dispose();
	});
});
