/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mock } from '../../../../../base/test/common/mock.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ExtHostCommands } from '../../../common/extHostCommands.js';
import { IExtHostWorkspace } from '../../../common/extHostWorkspace.js';
import { MainThreadAiFeaturesShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostAiFeatures } from '../../../common/positron/extHostAiFeatures.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';

/**
 * Builds the object under test. Skill roots are extension-host-local state, so
 * none of these collaborators are touched by the code exercised here: the
 * `mock`/`stubInterface` doubles throw loudly if that ever stops being true.
 */
function createAiFeatures(): ExtHostAiFeatures {
	const shape = new class extends mock<MainThreadAiFeaturesShape>() { };
	const commands = new class extends mock<ExtHostCommands>() { };
	return new ExtHostAiFeatures(
		SingleProxyRPCProtocol(shape),
		commands,
		stubInterface<IExtHostWorkspace>(),
	);
}

describe('ExtHostAiFeatures skill roots', () => {
	it('fires onDidChangeAgentSkillRoots when a root is registered', () => {
		const aiFeatures = createAiFeatures();
		let fired = 0;
		const listener = aiFeatures.onDidChangeAgentSkillRoots(() => fired++);

		aiFeatures.registerAgentSkillRoot('/skills');

		expect(fired).toBe(1);
		listener.dispose();
	});

	// The consumer's contract: the assistant re-reads the roots from inside its
	// listener, so a root registered before the event must already be readable
	// when the event arrives.
	it('has the new root readable from within the listener', async () => {
		const aiFeatures = createAiFeatures();
		let rootsSeenByListener: string[] | undefined;
		const listener = aiFeatures.onDidChangeAgentSkillRoots(async () => {
			rootsSeenByListener = await aiFeatures.getAgentSkillRoots();
		});

		aiFeatures.registerAgentSkillRoot('/skills');
		await Promise.resolve();

		expect(rootsSeenByListener).toEqual(['/skills']);
		listener.dispose();
	});

	it('fires onDidChangeAgentSkillRoots when a registered root is disposed', () => {
		const aiFeatures = createAiFeatures();
		const registration = aiFeatures.registerAgentSkillRoot('/skills');
		let fired = 0;
		const listener = aiFeatures.onDidChangeAgentSkillRoots(() => fired++);

		registration.dispose();

		expect(fired).toBe(1);
		listener.dispose();
	});
});
