/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename,
	managedCredentials: 'azure',
	enableFoundryAssistant: true,
});

test.describe('Posit Assistant - Microsoft Foundry (Azure managed credentials)', {
	tag: [tags.WORKBENCH_AZURE, tags.POSIT_ASSISTANT, tags.ASSISTANT],
}, () => {
	test('Foundry model responds when authenticated via Azure managed credentials', async function ({ app }) {
		// No interactive sign-in: the msFoundry provider obtains its token via
		// `vscode.authentication.getSession('ms-foundry', ...)`, which the
		// authentication extension brokers from the Posit Workbench managed
		// credential (scope `msfoundry`) once the fixture has signed into PWB via
		// Azure OIDC. The `posit.workbench.foundry.endpoint` setting (pushed by the
		// fixture via `enableFoundryAssistant`) gates that credential, so the
		// session is silently available here.
		await app.workbench.positAssistant.open();
		await app.workbench.positAssistant.waitForReady();
		await app.workbench.positAssistant.startNewConversation();

		// Other base-fixture providers stay enabled but unauthenticated on this
		// shard, so select the Foundry model explicitly rather than relying on an
		// auto-selected default. `newConversation: false` keeps the model we just
		// picked instead of resetting to a fresh chat.
		await app.workbench.positAssistant.selectModel('model-router');
		await app.workbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
		await app.workbench.positAssistant.expectResponseVisible();

		const responseText = await app.workbench.positAssistant.getLastResponseText();
		expect(responseText.length).toBeGreaterThan(0);
	});
});
