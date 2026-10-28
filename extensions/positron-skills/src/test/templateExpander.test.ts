/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AgentCommand, expandTemplate, TemplateFlags } from '../templateExpander';

const DESKTOP: TemplateFlags = { web: false };
const WEB: TemplateFlags = { web: true };

/** The templates directory, resolved from this compiled test's location in `out/test`. */
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

function commands(...list: AgentCommand[]): ReadonlyMap<string, AgentCommand> {
	return new Map(list.map(command => [command.id, command]));
}

suite('expandTemplate', () => {
	test('a command with no arguments renders "None." and prose passes through', () => {
		const result = expandTemplate(
			'Focuses the console.\n\n{{command:focus}}',
			commands({ id: 'focus' }),
			DESKTOP,
		);
		assert.deepStrictEqual(result, {
			text: 'Focuses the console.\n\n**Arguments:** None.\n\n**Returns:** None.',
			unresolved: [],
			problems: [],
		});
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
			DESKTOP,
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
			DESKTOP,
		);
		assert.deepStrictEqual(result, {
			text: '**Arguments:**\n- `topic` (string): Symbol to look up\n\n**Returns:** An object with `found` and `message`.',
			unresolved: [],
			problems: [],
		});
	});

	test('an optional argument is flagged, and enums render as their choices', () => {
		const result = expandTemplate(
			'{{command:x}}',
			commands({
				id: 'x',
				args: [{ name: 'mode', required: false, schema: { enum: ['fast', 'slow'] } }],
			}),
			DESKTOP,
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
			DESKTOP,
		);
		assert.strictEqual(result.text, '**Arguments:** None.\n\n**Returns:** None.');
	});

	test('an unknown command id degrades to an empty section and is reported as unresolved', () => {
		const result = expandTemplate(
			'{{command:gone}}',
			commands(),
			DESKTOP,
		);
		assert.deepStrictEqual(result, {
			text: '**Arguments:** None.\n\n**Returns:** None.',
			unresolved: ['gone'],
			problems: [],
		});
	});
});

suite('expandTemplate blocks', () => {
	const template = [
		'Before.',
		'',
		'{{if:web}}',
		'Only on web.',
		'{{endif}}',
		'',
		'After.',
	].join('\n');

	test('a block whose flag is set is kept, without its markers', () => {
		assert.deepStrictEqual(expandTemplate(template, commands(), WEB), {
			text: 'Before.\n\nOnly on web.\n\nAfter.',
			unresolved: [],
			problems: [],
		});
	});

	test('a dropped block leaves no extra blank lines behind', () => {
		assert.strictEqual(expandTemplate(template, commands(), DESKTOP).text, 'Before.\n\nAfter.');
	});

	test('a dropped block at the start or end of a file leaves no blank line', () => {
		assert.strictEqual(
			expandTemplate('{{if:web}}\nWeb.\n{{endif}}\n\nAfter.\n', commands(), DESKTOP).text,
			'After.\n',
		);
		assert.strictEqual(
			expandTemplate('Before.\n\n{{if:web}}\nWeb.\n{{endif}}\n', commands(), DESKTOP).text,
			'Before.\n',
		);
	});

	test('a dropped list item leaves the list contiguous', () => {
		const list = '- one\n{{if:web}}\n- two\n{{endif}}\n- three';
		assert.strictEqual(expandTemplate(list, commands(), DESKTOP).text, '- one\n- three');
		assert.strictEqual(expandTemplate(list, commands(), WEB).text, '- one\n- two\n- three');
	});

	test('command directives inside a kept block expand', () => {
		const result = expandTemplate('{{if:web}}\n{{command:focus}}\n{{endif}}', commands({ id: 'focus' }), WEB);
		assert.strictEqual(result.text, '**Arguments:** None.\n\n**Returns:** None.');
	});

	test('a command in a dropped block is not reported as unresolved', () => {
		const result = expandTemplate('{{if:web}}\n{{command:gone}}\n{{endif}}', commands(), DESKTOP);
		assert.deepStrictEqual(result, { text: '', unresolved: [], problems: [] });
	});

	test('other {{...}} text, such as Jinja, passes through untouched', () => {
		const jinja = '{{if:web}}\naction="{{ url_for(\'add\') }}" and {{skill_dir}}\n{{endif}}';
		assert.strictEqual(
			expandTemplate(jinja, commands(), WEB).text,
			'action="{{ url_for(\'add\') }}" and {{skill_dir}}',
		);
	});

	test('CRLF line endings are handled', () => {
		const crlf = 'Before.\r\n\r\n{{if:web}}\r\nWeb.\r\n{{endif}}\r\n\r\nAfter.';
		assert.deepStrictEqual(expandTemplate(crlf, commands(), DESKTOP), {
			text: 'Before.\r\n\r\nAfter.',
			unresolved: [],
			problems: [],
		});
	});

	test('malformed blocks are reported and never leak a marker', () => {
		const cases: [string, TemplateFlags, string, string[]][] = [
			['{{if:wbe}}\nTypo.\n{{endif}}\nAfter.', WEB, 'After.', ['line 1: unknown flag \'wbe\'']],
			['Before.\n{{if:web}}\nUnclosed.', DESKTOP, 'Before.', ['line 2: {{if:...}} has no {{endif}}']],
			['Before.\n{{endif}}\nAfter.', WEB, 'Before.\nAfter.', ['line 2: {{endif}} with no open {{if:...}}']],
			[
				'{{if:web}}\n{{if:web}}\nNested.\n{{endif}}\n{{endif}}',
				WEB,
				'Nested.',
				[
					'line 2: {{if:web}} is nested in the block opened on line 1',
					'line 5: {{endif}} with no open {{if:...}}',
				],
			],
			['Inline {{if:web}}text{{endif}}.', WEB, 'Inline text.', ['line 1: a block marker must be on a line of its own']],
		];
		for (const [input, flags, text, problems] of cases) {
			assert.deepStrictEqual(expandTemplate(input, commands(), flags), { text, unresolved: [], problems }, input);
		}
	});
});

/** Every `.md` file under `dir`, recursively, as absolute paths. */
function templateFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...templateFiles(full));
		} else if (entry.name.endsWith('.md')) {
			files.push(full);
		}
	}
	return files;
}

/** Expand a bundled template, ignoring command metadata. */
function expandBundled(relativePath: string, flags: TemplateFlags): string {
	const content = fs.readFileSync(path.join(TEMPLATES_DIR, relativePath), 'utf8');
	return expandTemplate(content, commands(), flags).text;
}

suite('bundled templates', () => {
	for (const file of templateFiles(TEMPLATES_DIR)) {
		const name = path.relative(TEMPLATES_DIR, file);
		test(`${name} has well-formed conditional blocks`, () => {
			const content = fs.readFileSync(file, 'utf8');
			for (const flags of [DESKTOP, WEB]) {
				assert.deepStrictEqual(expandTemplate(content, commands(), flags).problems, [], JSON.stringify(flags));
			}
		});
	}

	test('desktop output has no browser or Workbench-only guidance', () => {
		const files = [
			'positron-commands/SKILL.md',
			'positron-commands/references/interactive-apps.md',
			'positron-commands/references/viewer.md',
		];
		const forbidden = ['On Posit Workbench', 'in a browser', 'X-Forwarded-Prefix', 'ProxyFix', 'RS_SERVER_URL', 'proxy address'];
		for (const file of files) {
			const text = expandBundled(file, DESKTOP);
			for (const phrase of forbidden) {
				assert.ok(!text.includes(phrase), `${file} mentions "${phrase}" on desktop`);
			}
		}
	});

	test('web output keeps the proxy guidance and its Jinja example', () => {
		const text = expandBundled('positron-commands/references/interactive-apps.md', WEB);
		assert.ok(text.includes('## Serving apps through a proxy'));
		assert.ok(text.includes('action="{{ url_for(\'add\') }}"'));
	});
});
