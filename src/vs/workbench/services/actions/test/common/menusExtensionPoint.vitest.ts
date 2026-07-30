/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { toAgentMetadata } from '../../common/menusExtensionPoint.js';

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
