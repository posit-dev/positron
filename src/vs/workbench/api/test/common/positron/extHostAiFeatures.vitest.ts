/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IExtensionDescription } from '../../../../../../platform/extensions/common/extensions.js';
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

	/** An extension that declares the handlers. */
	function createExtension(...errorActionHandlers: object[]): IExtensionDescription {
		// The contribution point isn't one of upstream's typed contributions.
		const contributes: object = { errorActionHandlers };
		return stubInterface<IExtensionDescription>({ contributes: contributes as IExtensionDescription['contributes'] });
	}

	function createFeaturesWithProxy() {
		const proxy = stubInterface<MainThreadAiFeaturesShape>({
			$registerErrorActionHandler: vi.fn(),
			$unregisterErrorActionHandler: vi.fn(),
		});
		return { features: createFeatures(proxy), proxy };
	}

	it('registers a declared handler with its declared name and chat continuation', () => {
		const { features, proxy } = createFeaturesWithProxy();
		const extension = createExtension(
			{ id: 'agent', label: 'Agent' },
			{ id: 'chat-agent', label: 'Chat Agent', supportsChatContinuation: true },
		);

		features.registerErrorActionHandler(extension, 'agent', handler);
		features.registerErrorActionHandler(extension, 'chat-agent', handler);

		expect(proxy.$registerErrorActionHandler.mock.calls).toEqual([
			[0, 'agent', 'Agent', false],
			[1, 'chat-agent', 'Chat Agent', true],
		]);
	});

	it('throws for an undeclared id, the reserved id, and an id already registered, without telling the main thread', () => {
		const { features, proxy } = createFeaturesWithProxy();
		const extension = createExtension({ id: 'agent', label: 'Agent' }, { id: 'posit-assistant', label: 'Imposter' });
		features.registerErrorActionHandler(extension, 'agent', handler);

		expect(() => features.registerErrorActionHandler(extension, 'undeclared', handler)).toThrow(/must be declared/);
		expect(() => features.registerErrorActionHandler(extension, 'posit-assistant', handler)).toThrow(/reserved/);
		expect(() => features.registerErrorActionHandler(extension, 'agent', handler)).toThrow(/already registered/);
		expect(proxy.$registerErrorActionHandler).toHaveBeenCalledOnce();
	});

	it('frees the id once its registration is disposed', () => {
		const { features, proxy } = createFeaturesWithProxy();
		const extension = createExtension({ id: 'agent', label: 'Agent' });

		features.registerErrorActionHandler(extension, 'agent', handler).dispose();
		features.registerErrorActionHandler(extension, 'agent', handler);

		expect(proxy.$unregisterErrorActionHandler).toHaveBeenCalledWith(0);
		expect(proxy.$registerErrorActionHandler).toHaveBeenLastCalledWith(1, 'agent', 'Agent', false);
	});
});
