/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ExtHostCommands } from '../../../common/extHostCommands.js';
import { IExtHostWorkspace } from '../../../common/extHostWorkspace.js';
import { MainThreadAiFeaturesShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostAiFeatures } from '../../../common/positron/extHostAiFeatures.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';

/**
 * Builds an ExtHostAiFeatures whose `$activateSkillRootProviders` runs `onActivate` before
 * resolving, standing in for the contributing extensions registering their roots from
 * `activate()`.
 */
function createAiFeatures(onActivate: (aiFeatures: ExtHostAiFeatures) => void = () => { }): ExtHostAiFeatures {
	const shape = stubInterface<MainThreadAiFeaturesShape>({
		$activateSkillRootProviders: async () => onActivate(aiFeatures),
	});
	const aiFeatures = new ExtHostAiFeatures(
		SingleProxyRPCProtocol(shape),
		stubInterface<ExtHostCommands>({}),
		stubInterface<IExtHostWorkspace>({}),
	);
	return aiFeatures;
}

describe('ExtHostAiFeatures', () => {
	it('getAgentSkillRoots waits for the providers to activate before reading the roots', async () => {
		// The root is registered from within the activation the read awaits, so it is only
		// observed if the snapshot is taken after that activation completes.
		const aiFeatures = createAiFeatures((features) => features.registerAgentSkillRoot('/skills/platform'));

		expect(await aiFeatures.getAgentSkillRoots()).toEqual(['/skills/platform']);
	});

	it('registerAgentSkillRoot adds a root to later reads and its disposable removes it', async () => {
		const aiFeatures = createAiFeatures();

		const registration = aiFeatures.registerAgentSkillRoot('/skills/extension');
		expect(await aiFeatures.getAgentSkillRoots()).toEqual(['/skills/extension']);

		registration.dispose();
		expect(await aiFeatures.getAgentSkillRoots()).toEqual([]);
	});
});
