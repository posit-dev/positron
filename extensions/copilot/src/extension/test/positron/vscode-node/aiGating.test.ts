/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ConfigurationTarget, ExtensionContext, ExtensionMode, workspace } from 'vscode';
import { vscodeNodeContributions } from '../../../extension/vscode-node/contributions';
import { registerServices } from '../../../extension/vscode-node/services';
import { baseActivate } from '../../../extension/vscode/extension';

suite('Positron AI gating', function () {

	teardown(async () => {
		await workspace.getConfiguration().update('ai.enabled', undefined, ConfigurationTarget.Global);
	});

	test('does not activate when ai.enabled is false', async function () {
		await workspace.getConfiguration().update('ai.enabled', false, ConfigurationTarget.Global);

		// `forceActivation` skips the `ExtensionMode.Test` early return, so the
		// `ai.enabled` check is the only thing that can stop activation here.
		// `isPreRelease` is left unset so the pre-release return isn't the reason.
		const extensionContext = {
			extensionMode: ExtensionMode.Test,
			subscriptions: [] as { dispose(): void }[],
			extension: {
				packageJSON: { name: 'copilot' },
			},
		} as ExtensionContext;

		const result = await baseActivate({
			context: extensionContext,
			contributions: vscodeNodeContributions,
			registerServices,
			forceActivation: true,
		});

		// When the check stops activation it returns the same context before creating
		// any services or contributions, so nothing is added to `subscriptions`.
		assert.strictEqual(result, extensionContext);
		assert.strictEqual(extensionContext.subscriptions.length, 0);
	});
});
