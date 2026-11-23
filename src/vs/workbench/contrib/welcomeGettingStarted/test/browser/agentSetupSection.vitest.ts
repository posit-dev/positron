/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getAgentSetupItems } from '../../browser/positronWelcomePage/components/agentSetupSection.js';
import { IAgentSetupState } from '../../browser/positronWelcomePage/welcomeAgentSetup.js';

/**
 * Sums up each row as its id, status, and button label.
 * @param state The agent setup.
 */
function rows(state: IAgentSetupState) {
	return getAgentSetupItems(state).map(item => `${item.id}: ${item.status}${item.fix ? ` [${item.fix.label}]` : ''}`);
}

describe('getAgentSetupItems', () => {
	it('asks for an install first, and holds the provider row until then', () => {
		expect(rows({ aiEnabled: true, assistant: 'missing', providerSignedIn: false, mcpServerEnabled: false })).toMatchInlineSnapshot(`
			[
			  "assistant: warn [Install]",
			  "provider: skipped",
			  "mcp: skipped [Turn On]",
			]
		`);
	});

	it('asks for a provider sign-in once the Assistant is on', () => {
		expect(rows({ aiEnabled: true, assistant: 'on', providerSignedIn: false, mcpServerEnabled: false })).toMatchInlineSnapshot(`
			[
			  "assistant: pass",
			  "provider: warn [Sign In]",
			  "mcp: skipped [Turn On]",
			]
		`);
	});

	it('has nothing to do when everything is set up', () => {
		expect(rows({ aiEnabled: true, assistant: 'on', providerSignedIn: true, mcpServerEnabled: true })).toMatchInlineSnapshot(`
			[
			  "assistant: pass",
			  "provider: pass",
			  "mcp: pass",
			]
		`);
	});

	it('offers to turn the Assistant back on', () => {
		expect(rows({ aiEnabled: true, assistant: 'off', providerSignedIn: false, mcpServerEnabled: true })[0]).toBe('assistant: warn [Turn On]');
	});
});
