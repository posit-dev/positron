/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AgentCommand, expandTemplate } from '../templateExpander';

function commands(...list: AgentCommand[]): ReadonlyMap<string, AgentCommand> {
	return new Map(list.map(command => [command.id, command]));
}

suite('expandTemplate', () => {
	test('a command with no arguments renders "None." and prose passes through', () => {
		const result = expandTemplate(
			'Focuses the console.\n\n**Arguments:** {{args:focus}}\n\n**Returns:** {{returns:focus}}',
			commands({ id: 'focus' }),
		);
		assert.deepStrictEqual(result, {
			text: 'Focuses the console.\n\n**Arguments:** None.\n\n**Returns:** None.',
			unresolved: [],
		});
	});

	test('an object argument surfaces inner optionality even when itself required', () => {
		// The metadata marks `focusOptions` required, but `preserveFocus` inside
		// it is optional -- the rendered type must show that, since it is exactly
		// the fact a literal reading of the top-level `required` flag gets wrong.
		const result = expandTemplate(
			'{{args:pane.focus}}',
			commands({
				id: 'pane.focus',
				args: [{
					name: 'focusOptions',
					required: true,
					schema: { type: 'object', properties: { preserveFocus: { type: 'boolean' } } },
				}],
			}),
		);
		assert.strictEqual(result.text, '- `focusOptions` (object { preserveFocus?: boolean })');
	});

	test('a required scalar argument with a description, and a return value', () => {
		const result = expandTemplate(
			'**Arguments:**\n{{args:help.lookup}}\n**Returns:** {{returns:help.lookup}}',
			commands({
				id: 'help.lookup',
				args: [{ name: 'topic', schema: { type: 'string' }, description: 'Symbol to look up' }],
				returns: 'An object with `found` and `message`.',
			}),
		);
		assert.deepStrictEqual(result, {
			text: '**Arguments:**\n- `topic` (string): Symbol to look up\n**Returns:** An object with `found` and `message`.',
			unresolved: [],
		});
	});

	test('an optional argument is flagged, and enums render as their choices', () => {
		const result = expandTemplate(
			'{{args:x}}',
			commands({
				id: 'x',
				args: [{ name: 'mode', required: false, schema: { enum: ['fast', 'slow'] } }],
			}),
		);
		assert.strictEqual(result.text, '- `mode` ("fast" | "slow", optional)');
	});

	test('an unknown command id degrades to "None." and is reported as unresolved', () => {
		const result = expandTemplate(
			'**Arguments:** {{args:gone}}\n**Returns:** {{returns:gone}}',
			commands(),
		);
		assert.deepStrictEqual(result, {
			text: '**Arguments:** None.\n**Returns:** None.',
			unresolved: ['gone'],
		});
	});
});
