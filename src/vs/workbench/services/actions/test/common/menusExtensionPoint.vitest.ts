/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { gateCopilotContribution, toAgentMetadata } from '../../common/menusExtensionPoint.js';

describe('toAgentMetadata', () => {
	it('returns undefined when no agent field is present', () => {
		expect(toAgentMetadata(undefined)).toBeUndefined();
	});

	it('maps the agent field to command metadata', () => {
		const metadata = toAgentMetadata({
			description: 'Restart the session.',
			returns: 'void',
			args: [
				{ name: 'sessionId', description: 'Session to restart.', required: false },
				{ name: 'force' },
			],
		});

		expect(metadata).toMatchInlineSnapshot(`
			{
			  "agentCompatible": true,
			  "args": [
			    {
			      "description": "Session to restart.",
			      "isOptional": true,
			      "name": "sessionId",
			      "schema": undefined,
			    },
			    {
			      "description": undefined,
			      "isOptional": false,
			      "name": "force",
			      "schema": undefined,
			    },
			  ],
			  "description": "Restart the session.",
			  "returns": "void",
			}
		`);
	});
});

describe('gateCopilotContribution', () => {
	const copilot = new ExtensionIdentifier('github.copilot-chat');
	const other = new ExtensionIdentifier('posit.assistant');

	it('adds the AI switch to a Copilot contribution', () => {
		const gated = gateCopilotContribution(copilot, ContextKeyExpr.deserialize('editorHasSelection'));
		expect(gated?.serialize()).toBe('chatAiFeaturesEnabled && editorHasSelection');
	});

	it('gates a Copilot contribution that has no condition of its own', () => {
		const gated = gateCopilotContribution(copilot, undefined);
		expect(gated?.serialize()).toBe('chatAiFeaturesEnabled');
	});

	it('leaves other extensions alone', () => {
		expect(gateCopilotContribution(other, ContextKeyExpr.deserialize('editorHasSelection'))?.serialize())
			.toBe('editorHasSelection');
		expect(gateCopilotContribution(other, undefined)).toBeUndefined();
	});
});
