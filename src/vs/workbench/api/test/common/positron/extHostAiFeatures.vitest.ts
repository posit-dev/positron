/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IExtHostWorkspace } from '../../../common/extHostWorkspace.js';
import { MainThreadAiFeaturesShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostAiFeatures } from '../../../common/positron/extHostAiFeatures.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';

function createFeatures(proxy: MainThreadAiFeaturesShape | null = null): ExtHostAiFeatures {
	return new ExtHostAiFeatures(
		SingleProxyRPCProtocol(proxy),
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

describe('ExtHostAiFeatures error action handlers', () => {
	const handler = { ask: async () => { } };

	function createFeaturesWithProxy() {
		const proxy = stubInterface<MainThreadAiFeaturesShape>({
			$registerErrorActionHandler: vi.fn(),
			$unregisterErrorActionHandler: vi.fn(),
		});
		return { features: createFeatures(proxy), proxy };
	}

	it('throws for the reserved id and an id already registered, without telling the main thread', () => {
		const { features, proxy } = createFeaturesWithProxy();
		features.registerErrorActionHandler('agent', 'Agent', handler);

		expect(() => features.registerErrorActionHandler('posit-assistant', 'Imposter', handler)).toThrow(/reserved/);
		expect(() => features.registerErrorActionHandler('agent', 'Again', handler)).toThrow(/already registered/);
		expect(proxy.$registerErrorActionHandler).toHaveBeenCalledOnce();
	});

	it('frees the id once its registration is disposed', () => {
		const { features, proxy } = createFeaturesWithProxy();

		features.registerErrorActionHandler('agent', 'Agent', handler).dispose();
		features.registerErrorActionHandler('agent', 'Agent', handler);

		expect(proxy.$unregisterErrorActionHandler).toHaveBeenCalledWith(0);
		expect(proxy.$registerErrorActionHandler).toHaveBeenLastCalledWith(1, 'agent', 'Agent', false);
	});
});
