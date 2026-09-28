/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { SerializableObjectWithBuffers } from '../../../../services/extensions/common/proxyIdentifier.js';
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

describe('ExtHostAiFeatures Viewer screenshots', () => {
	beforeEach(() => {
		ensureNoLeakedDisposables();
	});

	it('hands out the PNG bytes as their own buffer, not a view into the RPC message', async () => {
		// After the RPC, the image is a view into the whole message buffer.
		const message = new Uint8Array([9, 9, 1, 2, 3, 9]);
		const features = new ExtHostAiFeatures(
			SingleProxyRPCProtocol({
				$getViewerScreenshot: async () => new SerializableObjectWithBuffers({
					mimeType: 'image/png', width: 1, height: 1, method: 'native', revealed: false,
					data: VSBuffer.wrap(message.subarray(2, 5)),
				}),
			}),
			stubInterface<ExtHostCommands>(),
			stubInterface<IExtHostWorkspace>(),
		);

		const { data } = await features.getViewerScreenshot();

		expect({ bytes: [...data], bufferLength: data.buffer.byteLength }).toEqual({ bytes: [1, 2, 3], bufferLength: 3 });
	});
});

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
