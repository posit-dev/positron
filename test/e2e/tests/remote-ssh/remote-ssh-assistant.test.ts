/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { connectToRemoteHost, sshKeyscan } from './connect';

test.use({
	suiteId: __filename,
	// This suite drives the legacy provider dialog, which is no longer the
	// default, so pin it. Remove the pin when this suite is ported to the new
	// modal (posit-dev/positron#15537).
	extraSettings: { 'assistant.newProviderModal': false },
});

// Only the remote-ssh tag: the lane that runs this suite is the one that
// extracts a real REH tarball into the docker host, which is what makes the test
// meaningful. Assistant lanes have no SSH host to connect to.
test.describe('Remote SSH: Posit Assistant', {
	tag: [tags.REMOTE_SSH]
}, () => {

	test.beforeAll(async () => {
		try {
			sshKeyscan('127.0.0.1', 3456, '/tmp/known_hosts');
		} catch (err) {
			throw new Error(`ssh-keyscan failed: ${(err as Error).message}`);
		}
	});

	// The provider list, the credential store, and the model request all live on
	// the remote host in a remote session: the catalog resolves from the remote
	// ~/.posit/ai/providers.json, the API key is written to the remote credential
	// store, and egress originates there. So this covers what a unit test cannot
	// reach -- when the server was missing the ai-config module the modal offered
	// only the local providers and the Anthropic tile was absent entirely
	// (posit-dev/positron#15306).
	test('Sign in to Anthropic and chat against the remote host', async function ({ app }) {
		// Opening the SSH connection alone can take most of the default 2 minute
		// budget, before the sign-in and the model round-trip.
		test.slow();

		const { sshWorkbench } = await connectToRemoteHost(app);

		await sshWorkbench.modelProviderAuth.loginModelProvider('anthropic-api');

		try {
			await sshWorkbench.positAssistant.open();
			await sshWorkbench.positAssistant.waitForReady();
			await sshWorkbench.positAssistant.startNewConversation();

			// Select the just-signed-in provider's model rather than relying on an
			// auto-selected default, which may belong to another signed-in provider.
			// `newConversation: false` keeps that selection.
			await sshWorkbench.positAssistant.selectProviderModel('anthropic-api');
			await sshWorkbench.positAssistant.sendMessage('Say hello', true, { newConversation: false });
			await sshWorkbench.positAssistant.expectResponseVisible();

			const responseText = await sshWorkbench.positAssistant.getLastResponseText();
			expect(responseText.length).toBeGreaterThan(0);
		} finally {
			await sshWorkbench.modelProviderAuth.logoutModelProvider('anthropic-api');
		}
	});
});
