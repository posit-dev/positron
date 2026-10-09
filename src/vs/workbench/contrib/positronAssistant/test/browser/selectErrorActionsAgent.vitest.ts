/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IErrorActionHandler, IRegisteredErrorActionHandler } from '../../common/errorActions.js';
import { getAgentPickItems } from '../../browser/selectErrorActionsAgent.js';

function registered(id: string, label: string, state: Partial<IRegisteredErrorActionHandler> = {}): IRegisteredErrorActionHandler {
	const handler: IErrorActionHandler = { id, label, run: async () => { } };
	return { handler, isEnabled: true, problem: undefined, ...state };
}

describe('getAgentPickItems', () => {
	it('offers Posit Assistant first, marking the selected agent and ones that cannot take errors', () => {
		const items = getAgentPickItems([
			registered('posit-assistant', 'Posit Assistant', { isEnabled: false, problem: 'No language model.' }),
			registered('claude-code', 'Claude Code', { problem: 'The claude command was not found.' }),
			registered('codex', 'Codex'),
		], 'claude-code');

		expect(items).toMatchInlineSnapshot(`
			[
			  {
			    "description": "Unavailable",
			    "detail": "$(warning) No language model.",
			    "id": "posit-assistant",
			    "label": "Posit Assistant",
			  },
			  {
			    "type": "separator",
			  },
			  {
			    "description": "Selected",
			    "detail": "$(warning) The claude command was not found.",
			    "id": "claude-code",
			    "label": "Claude Code",
			  },
			  {
			    "description": undefined,
			    "detail": undefined,
			    "id": "codex",
			    "label": "Codex",
			  },
			]
		`);
	});

	it('omits the separator when Posit Assistant is the only agent', () => {
		expect(getAgentPickItems([registered('posit-assistant', 'Posit Assistant')], 'posit-assistant')).toEqual([
			{ id: 'posit-assistant', label: 'Posit Assistant', description: 'Selected', detail: undefined },
		]);
	});
});
