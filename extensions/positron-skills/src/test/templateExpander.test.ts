/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AgentCommand, expandTemplate } from '../templateExpander';

function commands(...list: AgentCommand[]): ReadonlyMap<string, AgentCommand> {
	return new Map(list.map(command => [command.id, command]));
}

/** An ExpandResult with no problems reported, for whole-object comparisons. */
function clean(text: string) {
	return {
		text,
		unresolved: [],
		unknownFlags: [],
		unbalanced: [],
		sameFlagNesting: [],
		unknownValues: [],
	};
}

suite('expandTemplate', () => {
	test('a command with no arguments renders "None." and prose passes through', () => {
		const result = expandTemplate(
			'Focuses the console.\n\n{{command:focus}}',
			commands({ id: 'focus' }),
		);
		assert.deepStrictEqual(result, clean(
			'Focuses the console.\n\n**Arguments:** None.\n\n**Returns:** None.',
		));
	});

	test('an object argument surfaces inner optionality even when itself required', () => {
		// The metadata marks `focusOptions` required, but `preserveFocus` inside
		// it is optional -- the rendered type must show that, since it is exactly
		// the fact a literal reading of the top-level `required` flag gets wrong.
		// The argument list gets its own line under the label, not glued inline.
		const result = expandTemplate(
			'{{command:pane.focus}}',
			commands({
				id: 'pane.focus',
				args: [{
					name: 'focusOptions',
					required: true,
					schema: { type: 'object', properties: { preserveFocus: { type: 'boolean' } } },
				}],
			}),
		);
		assert.strictEqual(
			result.text,
			'**Arguments:**\n- `focusOptions` (object { preserveFocus?: boolean })\n\n**Returns:** None.',
		);
	});

	test('a required scalar argument with a description, and a return value', () => {
		const result = expandTemplate(
			'{{command:help.lookup}}',
			commands({
				id: 'help.lookup',
				args: [{ name: 'topic', schema: { type: 'string' }, description: 'Symbol to look up' }],
				returns: 'An object with `found` and `message`.',
			}),
		);
		assert.deepStrictEqual(result, clean(
			'**Arguments:**\n- `topic` (string): Symbol to look up\n\n**Returns:** An object with `found` and `message`.',
		));
	});

	test('an optional argument is flagged, and enums render as their choices', () => {
		const result = expandTemplate(
			'{{command:x}}',
			commands({
				id: 'x',
				args: [{ name: 'mode', required: false, schema: { enum: ['fast', 'slow'] } }],
			}),
		);
		assert.strictEqual(
			result.text,
			'**Arguments:**\n- `mode` ("fast" | "slow", optional)\n\n**Returns:** None.',
		);
	});

	test('an empty-string return value renders "None." rather than a blank line', () => {
		const result = expandTemplate(
			'{{command:noop}}',
			commands({ id: 'noop', returns: '   ' }),
		);
		assert.strictEqual(result.text, '**Arguments:** None.\n\n**Returns:** None.');
	});

	test('an unknown command id degrades to an empty section and is reported as unresolved', () => {
		const result = expandTemplate(
			'{{command:gone}}',
			commands(),
		);
		assert.deepStrictEqual(result, {
			...clean('**Arguments:** None.\n\n**Returns:** None.'),
			unresolved: ['gone'],
		});
	});

	suite('conditional blocks', () => {
		test('a block is kept when the flag is true and dropped when false', () => {
			const template = 'before\n\n{{#if pwb}}\nWorkbench only.\n{{/if}}\n\nafter';
			const on = expandTemplate(template, commands(), { pwb: true });
			assert.deepStrictEqual(on, clean('before\n\nWorkbench only.\n\nafter'));
			const off = expandTemplate(template, commands(), { pwb: false });
			assert.deepStrictEqual(off, clean('before\n\nafter'));
		});

		test('a negated condition inverts: kept when the flag is false', () => {
			const template = '{{#if !pwb}}desktop{{/if}}{{#if pwb}}workbench{{/if}}';
			assert.strictEqual(expandTemplate(template, commands(), { pwb: false }).text, 'desktop');
			assert.strictEqual(expandTemplate(template, commands(), { pwb: true }).text, 'workbench');
		});

		test('else keeps exactly one branch', () => {
			const template = '{{#if pwb}}workbench{{else}}desktop{{/if}}';
			assert.deepStrictEqual(expandTemplate(template, commands(), { pwb: true }), clean('workbench'));
			assert.deepStrictEqual(expandTemplate(template, commands(), { pwb: false }), clean('desktop'));
		});

		test('else on a negated condition keeps the branches in the stated order', () => {
			const template = '{{#if !pwb}}desktop{{else}}workbench{{/if}}';
			assert.strictEqual(expandTemplate(template, commands(), { pwb: false }).text, 'desktop');
			assert.strictEqual(expandTemplate(template, commands(), { pwb: true }).text, 'workbench');
		});

		test('multi-line if/else keeps one branch and caps the seams at one blank line', () => {
			const template = 'before\n\n{{#if pwb}}\nworkbench\n{{else}}\ndesktop\n{{/if}}\n\nafter';
			assert.strictEqual(
				expandTemplate(template, commands(), { pwb: true }).text,
				'before\n\nworkbench\n\nafter',
			);
			assert.strictEqual(
				expandTemplate(template, commands(), { pwb: false }).text,
				'before\n\ndesktop\n\nafter',
			);
		});

		test('inline blocks splice into the surrounding sentence without newline damage', () => {
			const template = 'Triggers: "run my app"{{#if pwb}}, "the app URL does not load"{{/if}}.';
			assert.strictEqual(
				expandTemplate(template, commands(), { pwb: true }).text,
				'Triggers: "run my app", "the app URL does not load".',
			);
			assert.strictEqual(
				expandTemplate(template, commands(), { pwb: false }).text,
				'Triggers: "run my app".',
			);
		});

		test('a dropped block suppresses its command directives, so they are not counted as drift', () => {
			const result = expandTemplate(
				'{{#if pwb}}\n{{command:gone}}\n{{/if}}\nalways',
				commands(),
				{ pwb: false },
			);
			assert.deepStrictEqual(result, clean('\nalways'));
		});

		test('a dropped else branch suppresses its command directives too', () => {
			const result = expandTemplate(
				'{{#if pwb}}kept{{else}}{{command:gone}}{{/if}}',
				commands(),
				{ pwb: true },
			);
			assert.deepStrictEqual(result, clean('kept'));
		});

		test('a kept block still expands the command directives inside it', () => {
			const result = expandTemplate(
				'{{#if pwb}}{{command:focus}}{{/if}}',
				commands({ id: 'focus' }),
				{ pwb: true },
			);
			assert.strictEqual(result.text, '**Arguments:** None.\n\n**Returns:** None.');
		});

		test('nested blocks of different flags resolve, inner within outer', () => {
			const template = '{{#if a}}A{{#if b}} and B{{/if}}{{/if}}';
			assert.strictEqual(expandTemplate(template, commands(), { a: true, b: true }).text, 'A and B');
			assert.strictEqual(expandTemplate(template, commands(), { a: true, b: false }).text, 'A');
			assert.strictEqual(expandTemplate(template, commands(), { a: false, b: true }).text, '');
		});

		test('a nested block inside a dropped branch stays dropped whatever its own condition', () => {
			const template = '{{#if a}}{{#if b}}x{{else}}y{{/if}}{{else}}z{{/if}}';
			assert.strictEqual(expandTemplate(template, commands(), { a: false, b: true }).text, 'z');
			assert.strictEqual(expandTemplate(template, commands(), { a: false, b: false }).text, 'z');
		});

		test('an else inside a nested block flips only the inner block', () => {
			const template = '{{#if a}}A{{#if b}}B{{else}}notB{{/if}} tail{{/if}}';
			assert.strictEqual(expandTemplate(template, commands(), { a: true, b: false }).text, 'AnotB tail');
			assert.strictEqual(expandTemplate(template, commands(), { a: true, b: true }).text, 'AB tail');
		});

		test('closers pair with their own opener, not the first closer in the text', () => {
			// This is the mispairing the old regex resolver had: the outer opener
			// must skip past the whole nested block to its own closer, so nothing
			// leaks from a dropped outer block and nothing is lost from a kept one.
			const template = '{{#if a}}A1 {{#if a}}A2{{/if}} A3{{/if}} tail';
			const on = expandTemplate(template, commands(), { a: true });
			assert.strictEqual(on.text, 'A1 A2 A3 tail');
			const off = expandTemplate(template, commands(), { a: false });
			assert.strictEqual(off.text, ' tail');
		});

		test('same-flag nesting is reported as an authoring error', () => {
			const result = expandTemplate(
				'{{#if pwb}}{{#if !pwb}}dead{{/if}}{{/if}}',
				commands(),
				{ pwb: true },
			);
			// The inner condition still resolves honestly (it is false here), but
			// the construct is flagged: a flag nested inside itself is always
			// either redundant or dead text.
			assert.strictEqual(result.text, '');
			assert.deepStrictEqual(result.sameFlagNesting, ['{{#if !pwb}}']);
		});

		test('the same flag in sibling (non-nested) blocks is not an error', () => {
			const result = expandTemplate(
				'{{#if pwb}}a{{/if}}{{#if pwb}}b{{/if}}',
				commands(),
				{ pwb: true },
			);
			assert.deepStrictEqual(result, clean('ab'));
		});

		test('a flag the caller did not provide counts as false and is reported', () => {
			const result = expandTemplate(
				'{{#if mystery}}x{{else}}y{{/if}}',
				commands(),
				{},
			);
			assert.strictEqual(result.text, 'y');
			assert.deepStrictEqual(result.unknownFlags, ['mystery']);
		});

		test('an unknown flag inside a dropped branch is still reported', () => {
			const result = expandTemplate(
				'{{#if pwb}}{{#if mystery}}x{{/if}}{{/if}}',
				commands(),
				{ pwb: false },
			);
			assert.strictEqual(result.text, '');
			assert.deepStrictEqual(result.unknownFlags, ['mystery']);
		});

		test('an unterminated opener honors its condition to the end of the input and is reported', () => {
			const template = 'before {{#if pwb}}workbench tail';
			const on = expandTemplate(template, commands(), { pwb: true });
			assert.strictEqual(on.text, 'before workbench tail');
			assert.deepStrictEqual(on.unbalanced, ['{{#if pwb}}']);
			// The dropped side must not leak the body: this is the silent-leak
			// failure mode, so it matters more than the kept side.
			const off = expandTemplate(template, commands(), { pwb: false });
			assert.strictEqual(off.text, 'before ');
			assert.deepStrictEqual(off.unbalanced, ['{{#if pwb}}']);
		});

		test('an orphan closer is dropped from the output and reported', () => {
			const result = expandTemplate('a{{/if}}b', commands(), {});
			assert.strictEqual(result.text, 'ab');
			assert.deepStrictEqual(result.unbalanced, ['{{/if}}']);
		});

		test('an orphan else is dropped from the output, has no effect, and is reported', () => {
			const result = expandTemplate('a{{else}}b', commands(), {});
			assert.strictEqual(result.text, 'ab');
			assert.deepStrictEqual(result.unbalanced, ['{{else}}']);
		});

		test('a second else in one block is dropped, has no effect, and is reported', () => {
			const template = '{{#if pwb}}a{{else}}b{{else}}c{{/if}}';
			const result = expandTemplate(template, commands(), { pwb: false });
			// The first else already flipped to the kept branch; the second is
			// inert, so b and c are one branch.
			assert.strictEqual(result.text, 'bc');
			assert.deepStrictEqual(result.unbalanced, ['{{else}}']);
		});

		test('non-marker double braces pass through verbatim', () => {
			// Templates hold Jinja examples like {{ url_for('add') }} inside code
			// fences; only the exact marker forms are directives.
			const template = '{{#if pwb}}action="{{ url_for(\'add\') }}"{{/if}}';
			const result = expandTemplate(template, commands(), { pwb: true });
			assert.deepStrictEqual(result, clean('action="{{ url_for(\'add\') }}"'));
		});
	});

	suite('blank lines at removal seams', () => {
		test('dropping a block between blank lines leaves one blank line, not three', () => {
			const template = 'before\n\n{{#if pwb}}\nbody\n{{/if}}\n\nafter';
			assert.strictEqual(
				expandTemplate(template, commands(), { pwb: false }).text,
				'before\n\nafter',
			);
		});

		test('blank lines inside a kept branch are preserved verbatim', () => {
			// A PEP8-style example keeps two blank lines between top-level defs;
			// collapsing them would silently corrupt the code the skill shows.
			const template = '{{#if pwb}}\n```python\ndef a():\n\tpass\n\n\ndef b():\n\tpass\n```\n{{/if}}';
			assert.strictEqual(
				expandTemplate(template, commands(), { pwb: true }).text,
				'\n```python\ndef a():\n\tpass\n\n\ndef b():\n\tpass\n```\n',
			);
		});

		test('blank-line runs outside any conditional are preserved verbatim', () => {
			const template = 'a\n\n\n\nb';
			assert.strictEqual(expandTemplate(template, commands(), {}).text, 'a\n\n\n\nb');
		});
	});

	suite('value directives', () => {
		test('a provided value substitutes everywhere it appears', () => {
			const result = expandTemplate(
				'root {{skill_dir}} and again {{skill_dir}}',
				commands(),
				{},
				{ skill_dir: '/skills/commands' },
			);
			assert.deepStrictEqual(result, clean('root /skills/commands and again /skills/commands'));
		});

		test('an unknown name is left verbatim and reported', () => {
			// Unlike commands and conditionals, a bare {{name}} can be literal
			// example text, so the output keeps it; the report is the signal.
			const result = expandTemplate(
				'uri is vscode-remote://{{remote_authorty}}/path',
				commands(),
				{},
				{ remote_authority: 'localhost:8787' },
			);
			assert.strictEqual(result.text, 'uri is vscode-remote://{{remote_authorty}}/path');
			assert.deepStrictEqual(result.unknownValues, ['remote_authorty']);
		});

		test('an unknown name inside a dropped branch is still reported', () => {
			// The branch dropped here is the one kept in the other environment,
			// so the typo must surface regardless of the current flags.
			const result = expandTemplate(
				'{{#if remote}}{{remote_authorty}}{{/if}}kept',
				commands(),
				{ remote: false },
				{ remote_authority: 'localhost:8787' },
			);
			assert.strictEqual(result.text, 'kept');
			assert.deepStrictEqual(result.unknownValues, ['remote_authorty']);
		});

		test('a value inside a kept branch substitutes; an empty value renders empty', () => {
			const template = '{{#if remote}}vscode-remote://{{remote_authority}}/x{{else}}/x{{/if}}';
			assert.strictEqual(
				expandTemplate(template, commands(), { remote: true }, { remote_authority: 'localhost:8787' }).text,
				'vscode-remote://localhost:8787/x',
			);
			assert.strictEqual(
				expandTemplate(template, commands(), { remote: false }, { remote_authority: '' }).text,
				'/x',
			);
		});

		test('conditional markers and command directives are not value directives', () => {
			// {{else}} matches the value shape lexically and is excluded by name;
			// the other marker shapes cannot match at all.
			const result = expandTemplate(
				'{{#if pwb}}a{{else}}b{{/if}} {{command:gone}}',
				commands(),
				{ pwb: false },
				{},
			);
			assert.strictEqual(result.text, 'b **Arguments:** None.\n\n**Returns:** None.');
			assert.deepStrictEqual(result.unknownValues, []);
			assert.deepStrictEqual(result.unresolved, ['gone']);
		});

		test('mustache-like example code with spaces or calls is not matched', () => {
			const template = `action="{{ url_for('add') }}"`;
			const result = expandTemplate(template, commands(), {}, {});
			assert.deepStrictEqual(result, clean(template));
		});
	});
});
