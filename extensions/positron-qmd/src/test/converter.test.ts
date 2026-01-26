/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { QmdParser } from '../parser.js';
import { QmdNotebookSerializer } from '../qmdNotebookSerializer.js';
import { serialize as serializeNotebook } from '../serialize.js';
import { captureLogs } from './util/captureLogs.js';
import { TextEncoder } from 'util';

const EXTENSION_ID = 'positron.positron-qmd';

suite('QMD to NotebookData Converter', () => {
	captureLogs();

	let serializer: QmdNotebookSerializer;
	const cancellationToken = new vscode.CancellationTokenSource().token;

	suiteSetup(async () => {
		// Create parser and serializer using extension's URI
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `Extension ${EXTENSION_ID} should be present`);
		const parser = new QmdParser(extension.extensionUri);
		const log = vscode.window.createOutputChannel('QMD Test', { log: true });
		serializer = new QmdNotebookSerializer(parser, log);
	});

	/**
	 * Helper to deserialize QMD content to NotebookData.
	 */
	async function deserialize(content: string): Promise<vscode.NotebookData> {
		const encoder = new TextEncoder();
		return serializer.deserializeNotebook(encoder.encode(content), cancellationToken);
	}

	test('should convert CodeBlock to code cell', async () => {
		const result = await deserialize('```{python}\nprint("hello")\n```');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[0].languageId, 'python');
		assert.strictEqual(result.cells[0].value, 'print("hello")');
	});

	test('should merge consecutive markdown blocks with source extraction', async () => {
		const result = await deserialize('# Title\n\nSome paragraph text.');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[0].value, '# Title\n\nSome paragraph text.');
	});

	test('should convert RawBlock to code cell with format as language', async () => {
		const result = await deserialize('```{=latex}\n\\frac{1}{2}\n```');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[0].languageId, 'latex');
	});

	test('should use "text" for CodeBlock without language', async () => {
		const result = await deserialize('```\nsome code\n```');

		assert.strictEqual(result.cells[0].languageId, 'text');
	});

	test('should map Quarto language aliases', async () => {
		const result = await deserialize('```{py}\nprint("hello")\n```');

		assert.strictEqual(result.cells[0].languageId, 'python');
	});

	test('should extract frontmatter to first cell', async () => {
		const result = await deserialize('---\ntitle: Test\nauthor: User\n---\n\n# Content');

		// First cell should be frontmatter
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[0].languageId, 'yaml');
		assert.strictEqual(result.cells[0].metadata?.qmdCellType, 'frontmatter');
		assert.ok(result.cells[0].value.includes('title: Test'));
		assert.ok(result.cells[0].value.includes('author: User'));
		// Should include --- delimiters
		assert.ok(result.cells[0].value.startsWith('---'));
		assert.ok(result.cells[0].value.endsWith('---'));
	});

	test('should preserve markdown content after front matter', async () => {
		const result = await deserialize('---\ntitle: Test\n---\n\n# Heading\n\nParagraph text.');

		// First cell is frontmatter, second is markdown
		assert.strictEqual(result.cells.length, 2);
		assert.strictEqual(result.cells[0].metadata?.qmdCellType, 'frontmatter');
		assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[1].value, '# Heading\n\nParagraph text.');
	});

	test('should handle multi-byte UTF-8 characters correctly', async () => {
		const result = await deserialize('# Pokémon\n\nI love Pokémon!');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[0].value, '# Pokémon\n\nI love Pokémon!');
	});

	test('should handle multi-byte UTF-8 before code block', async () => {
		// 'é' is 2 bytes in UTF-8, so byte offsets differ from character offsets
		const result = await deserialize('# Pokémon\n\n```{python}\nprint("hello")\n```');

		assert.strictEqual(result.cells.length, 2);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[0].value, '# Pokémon');
		assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[1].value, 'print("hello")');
	});

	test('should handle markdown after code with UTF-8', async () => {
		// If byte offsets are used incorrectly, the markdown after code will be wrong
		const result = await deserialize('```{python}\nprint("Pokémon")\n```\n\n# Results');

		assert.strictEqual(result.cells.length, 2);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[0].value, 'print("Pokémon")');
		assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[1].value, '# Results');
	});

	test('should handle markdown after front matter with UTF-8', async () => {
		// Simpler repro case: UTF-8 in front matter, then markdown
		const result = await deserialize('---\ntitle: Pokémon\n---\n\nThis');

		// First cell is frontmatter, second is markdown
		assert.strictEqual(result.cells.length, 2);
		assert.strictEqual(result.cells[0].metadata?.qmdCellType, 'frontmatter');
		assert.ok(result.cells[0].value.includes('Pokémon'));
		assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[1].value, 'This');
	});

	test('should handle Div blocks as markdown content', async () => {
		const result = await deserialize('::: {.callout-note}\nThis is a callout.\n:::');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
		// Should preserve exact callout syntax
		assert.ok(result.cells[0].value.includes('::: {.callout-note}'));
	});

	test('should interleave markdown and code cells correctly', async () => {
		const result = await deserialize('# Intro\n\n```{python}\nx = 1\n```\n\n## Results\n\n```{r}\nplot(x)\n```');

		assert.strictEqual(result.cells.length, 4);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[1].languageId, 'python');
		assert.strictEqual(result.cells[2].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[3].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[3].languageId, 'r');
		// Verify content is preserved exactly
		assert.strictEqual(result.cells[0].value, '# Intro');
		assert.strictEqual(result.cells[2].value, '## Results');
	});

	test('should handle R language', async () => {
		const result = await deserialize('```{r}\nplot(x)\n```');

		assert.strictEqual(result.cells[0].languageId, 'r');
	});

	test('should handle Julia language alias', async () => {
		const result = await deserialize('```{jl}\nprintln("hi")\n```');

		assert.strictEqual(result.cells[0].languageId, 'julia');
	});

	test('should store fence info in metadata', async () => {
		const result = await deserialize('```{python}\n#| echo: false\nprint("hello")\n```');

		assert.ok(result.cells[0].metadata?.qmdFenceInfo, 'Should have qmdFenceInfo');
		assert.strictEqual(result.cells[0].metadata.qmdFenceInfo, '{python}');
	});

	test('should open empty document with no cells', async () => {
		const result = await deserialize('');

		assert.strictEqual(result.cells.length, 0);
	});

	test('should handle document with only metadata', async () => {
		const result = await deserialize('---\ntitle: Test\n---\n\n# Heading');

		// Should have frontmatter cell
		assert.strictEqual(result.cells[0].metadata?.qmdCellType, 'frontmatter');
		assert.ok(result.cells[0].value.includes('title: Test'));
	});

	test('should handle code cell with multiple execution options', async () => {
		const result = await deserialize('```{python}\n#| echo: false\n#| eval: true\n#| output: asis\nprint("hello")\n```');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[0].languageId, 'python');
	});

	test('should preserve code content exactly', async () => {
		const code = 'def foo():\n    return 42\n\nprint(foo())';
		const result = await deserialize('```{python}\n' + code + '\n```');

		assert.strictEqual(result.cells[0].value, code);
	});

	test('should handle multiple code blocks with different languages', async () => {
		const result = await deserialize('```{python}\nx = 1\n```\n\n```{r}\ny <- 2\n```\n\n```{julia}\nz = 3\n```');

		assert.strictEqual(result.cells.length, 3);
		assert.strictEqual(result.cells[0].languageId, 'python');
		assert.strictEqual(result.cells[1].languageId, 'r');
		assert.strictEqual(result.cells[2].languageId, 'julia');
	});

	test('should handle HorizontalRule in markdown', async () => {
		const result = await deserialize('# Before\n\n---\n\n# After');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[0].value, '# Before\n\n---\n\n# After');
	});

	test('should handle HorizontalRule between code blocks', async () => {
		const result = await deserialize('```{python}\nx = 1\n```\n\n---\n\n```{python}\ny = 2\n```');

		assert.strictEqual(result.cells.length, 3);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[1].value, '---');
		assert.strictEqual(result.cells[2].kind, vscode.NotebookCellKind.Code);
	});
});

suite('NotebookData to QMD Serializer', () => {
	captureLogs();

	/**
	 * Helper to create NotebookData and serialize to QMD string.
	 */
	function serialize(cells: vscode.NotebookCellData[], metadata?: Record<string, unknown>): string {
		const notebook = new vscode.NotebookData(cells);
		notebook.metadata = metadata;
		return serializeNotebook(notebook);
	}

	function codeCell(code: string, language: string, metadata?: Record<string, unknown>): vscode.NotebookCellData {
		const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, language);
		cell.metadata = metadata;
		return cell;
	}

	function markdownCell(content: string): vscode.NotebookCellData {
		return new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, content, 'markdown');
	}

	test('should serialize code cell to fenced code block', () => {
		const result = serialize([codeCell('print("hello")', 'python')]);

		assert.strictEqual(result, '```{python}\nprint("hello")\n```\n');
	});

	test('should serialize markdown cell as-is', () => {
		const result = serialize([markdownCell('# Title\n\nSome paragraph text.')]);

		assert.strictEqual(result, '# Title\n\nSome paragraph text.\n');
	});

	test('should serialize R code cell', () => {
		const result = serialize([codeCell('plot(x)', 'r')]);

		assert.strictEqual(result, '```{r}\nplot(x)\n```\n');
	});

	test('should serialize Julia code cell', () => {
		const result = serialize([codeCell('println("hi")', 'julia')]);

		assert.strictEqual(result, '```{julia}\nprintln("hi")\n```\n');
	});

	test('should serialize plain code block without braces', () => {
		const result = serialize([codeCell('some code', 'text')]);

		assert.strictEqual(result, '```{text}\nsome code\n```\n');
	});

	test('should insert <!-- cell --> between consecutive markdown cells', () => {
		const result = serialize([
			markdownCell('# Cell 1'),
			markdownCell('# Cell 2'),
		]);

		assert.strictEqual(result, '# Cell 1\n\n<!-- cell -->\n\n# Cell 2\n');
	});

	test('should not insert marker between markdown and code cells', () => {
		const result = serialize([
			markdownCell('# Intro'),
			codeCell('x = 1', 'python'),
		]);

		assert.ok(!result.includes('<!-- cell -->'));
		assert.strictEqual(result, '# Intro\n\n```{python}\nx = 1\n```\n');
	});

	test('should not insert marker between code and markdown cells', () => {
		const result = serialize([
			codeCell('x = 1', 'python'),
			markdownCell('# Results'),
		]);

		assert.ok(!result.includes('<!-- cell -->'));
	});

	test('should not insert marker between consecutive code cells', () => {
		const result = serialize([
			codeCell('x = 1', 'python'),
			codeCell('y = 2', 'r'),
		]);

		assert.ok(!result.includes('<!-- cell -->'));
	});

	test('should interleave markdown and code cells correctly', () => {
		const result = serialize([
			markdownCell('# Intro'),
			codeCell('x = 1', 'python'),
			markdownCell('## Results'),
			codeCell('plot(x)', 'r'),
		]);

		assert.ok(result.includes('# Intro'));
		assert.ok(result.includes('```{python}'));
		assert.ok(result.includes('## Results'));
		assert.ok(result.includes('```{r}'));
		assert.ok(!result.includes('<!-- cell -->'));
	});

	test('should handle three consecutive markdown cells', () => {
		const result = serialize([
			markdownCell('# One'),
			markdownCell('# Two'),
			markdownCell('# Three'),
		]);

		const markers = (result.match(/<!-- cell -->/g) || []).length;
		assert.strictEqual(markers, 2, 'Should have 2 markers for 3 consecutive markdown cells');
	});

	test('should preserve multiline code content exactly', () => {
		const code = 'def foo():\n    return 42\n\nprint(foo())';
		const result = serialize([codeCell(code, 'python')]);

		assert.ok(result.includes(code));
	});

	test('should serialize frontmatter cell', () => {
		const frontmatterCell = new vscode.NotebookCellData(
			vscode.NotebookCellKind.Code,
			'---\ntitle: Test Document\nauthor: Test Author\n---',
			'yaml'
		);
		frontmatterCell.metadata = { qmdCellType: 'frontmatter' };

		const result = serialize([frontmatterCell, markdownCell('# Content')]);

		assert.ok(result.startsWith('---\n'));
		assert.ok(result.includes('title: Test Document'));
		assert.ok(result.includes('author: Test Author'));
	});

	test('should not emit empty frontmatter cell', () => {
		const frontmatterCell = new vscode.NotebookCellData(
			vscode.NotebookCellKind.Code,
			'',
			'yaml'
		);
		frontmatterCell.metadata = { qmdCellType: 'frontmatter' };

		const result = serialize([frontmatterCell, markdownCell('# Content')]);

		assert.ok(!result.startsWith('---'));
		assert.ok(result.startsWith('# Content'));
	});

	test('should skip empty markdown cells', () => {
		const result = serialize([
			markdownCell('# Title'),
			markdownCell(''),
			markdownCell('# Another'),
		]);

		// Should only have one marker (between Title and Another), not two
		const markers = (result.match(/<!-- cell -->/g) || []).length;
		assert.strictEqual(markers, 1);
	});

	test('should handle code cell with execution options in content', () => {
		const code = '#| echo: false\n#| eval: true\nprint("hello")';
		const result = serialize([codeCell(code, 'python')]);

		assert.ok(result.includes('#| echo: false'));
		assert.ok(result.includes('#| eval: true'));
	});

	test('should preserve Quarto div syntax in markdown', () => {
		const content = '::: {.callout-note}\nThis is a callout.\n:::';
		const result = serialize([markdownCell(content)]);

		assert.ok(result.includes('::: {.callout-note}'));
		assert.ok(result.includes(':::'));
	});

	test('should preserve raw fence info', () => {
		const cell = codeCell('x = 1', 'python', {
			qmdFenceInfo: '{python #myid label="fig-1"}'
		});
		const result = serialize([cell]);

		assert.ok(result.includes('```{python #myid label="fig-1"}'));
	});

});

suite('Deserialize with cell markers', () => {
	captureLogs();

	let serializer: QmdNotebookSerializer;
	const cancellationToken = new vscode.CancellationTokenSource().token;

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `Extension ${EXTENSION_ID} should be present`);
		const parser = new QmdParser(extension.extensionUri);
		const log = vscode.window.createOutputChannel('QMD Test Cell Markers', { log: true });
		serializer = new QmdNotebookSerializer(parser, log);
	});

	async function deserialize(content: string): Promise<vscode.NotebookData> {
		const encoder = new TextEncoder();
		return serializer.deserializeNotebook(encoder.encode(content), cancellationToken);
	}

	test('should split markdown at <!-- cell --> marker', async () => {
		const result = await deserialize('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

		assert.strictEqual(result.cells.length, 2);
		assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(result.cells[0].value.trim(), '# Cell 1');
		assert.strictEqual(result.cells[1].value.trim(), '# Cell 2');
	});

	test('should handle multiple cell markers', async () => {
		const result = await deserialize('# One\n\n<!-- cell -->\n\n# Two\n\n<!-- cell -->\n\n# Three');

		assert.strictEqual(result.cells.length, 3);
	});

	test('should not include marker content in cells', async () => {
		const result = await deserialize('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

		assert.ok(!result.cells[0].value.includes('<!-- cell -->'));
		assert.ok(!result.cells[1].value.includes('<!-- cell -->'));
	});

	test('should handle marker between code blocks', async () => {
		const result = await deserialize('```{python}\nx = 1\n```\n\n<!-- cell -->\n\n```{r}\ny = 2\n```');

		// Should have 2 code cells (marker is ignored between code blocks)
		const codeCells = result.cells.filter(c => c.kind === vscode.NotebookCellKind.Code);
		assert.ok(codeCells.some(c => c.languageId === 'python'));
		assert.ok(codeCells.some(c => c.languageId === 'r'));
	});

	test('should handle marker at document start', async () => {
		const result = await deserialize('<!-- cell -->\n\n# Content');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].value.trim(), '# Content');
	});

	test('should handle marker at document end', async () => {
		const result = await deserialize('# Content\n\n<!-- cell -->');

		assert.strictEqual(result.cells.length, 1);
		assert.strictEqual(result.cells[0].value.trim(), '# Content');
	});
});

suite('Round-trip serialization', () => {
	captureLogs();

	let serializer: QmdNotebookSerializer;
	const cancellationToken = new vscode.CancellationTokenSource().token;

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `Extension ${EXTENSION_ID} should be present`);
		const parser = new QmdParser(extension.extensionUri);
		const log = vscode.window.createOutputChannel('QMD Test Round-trip', { log: true });
		serializer = new QmdNotebookSerializer(parser, log);
	});

	async function deserialize(content: string): Promise<vscode.NotebookData> {
		const encoder = new TextEncoder();
		return serializer.deserializeNotebook(encoder.encode(content), cancellationToken);
	}

	function codeCell(code: string, language: string): vscode.NotebookCellData {
		return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, language);
	}

	function markdownCell(content: string): vscode.NotebookCellData {
		return new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, content, 'markdown');
	}

	test('should round-trip simple document', async () => {
		const original = '# Hello\n\n```{python}\nprint("world")\n```\n';
		const notebook = await deserialize(original);
		const serialized = serializeNotebook(notebook);
		const roundTripped = await deserialize(serialized);

		assert.strictEqual(roundTripped.cells.length, notebook.cells.length);
		for (let i = 0; i < notebook.cells.length; i++) {
			assert.strictEqual(roundTripped.cells[i].kind, notebook.cells[i].kind);
			assert.strictEqual(roundTripped.cells[i].value.trim(), notebook.cells[i].value.trim());
		}
	});

	test('should round-trip document with consecutive markdown cells', async () => {
		// Create notebook with consecutive markdown cells programmatically
		const notebook = new vscode.NotebookData([
			markdownCell('# Cell 1'),
			markdownCell('# Cell 2'),
			codeCell('x = 1', 'python'),
			markdownCell('# Cell 3'),
		]);

		const serialized = serializeNotebook(notebook);
		const roundTripped = await deserialize(serialized);

		assert.strictEqual(roundTripped.cells.length, 4);
		assert.strictEqual(roundTripped.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(roundTripped.cells[1].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(roundTripped.cells[2].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(roundTripped.cells[3].kind, vscode.NotebookCellKind.Markup);
		// Verify content is preserved - especially important for consecutive markdown cells
		assert.strictEqual(roundTripped.cells[0].value, '# Cell 1');
		assert.strictEqual(roundTripped.cells[1].value, '# Cell 2');
		assert.strictEqual(roundTripped.cells[2].value, 'x = 1');
		assert.strictEqual(roundTripped.cells[3].value, '# Cell 3');
	});

	test('should round-trip code cell languages', async () => {
		const notebook = new vscode.NotebookData([
			codeCell('x = 1', 'python'),
			codeCell('y <- 2', 'r'),
			codeCell('z = 3', 'julia'),
		]);

		const serialized = serializeNotebook(notebook);
		const roundTripped = await deserialize(serialized);

		assert.strictEqual(roundTripped.cells[0].languageId, 'python');
		assert.strictEqual(roundTripped.cells[1].languageId, 'r');
		assert.strictEqual(roundTripped.cells[2].languageId, 'julia');
	});

	test('should round-trip code content exactly', async () => {
		const code = 'def foo():\n    return 42\n\nprint(foo())';
		const notebook = new vscode.NotebookData([codeCell(code, 'python')]);

		const serialized = serializeNotebook(notebook);
		const roundTripped = await deserialize(serialized);

		assert.strictEqual(roundTripped.cells[0].value, code);
	});

	test('should round-trip mixed content document', async () => {
		const notebook = new vscode.NotebookData([
			markdownCell('# Introduction'),
			codeCell('import pandas as pd', 'python'),
			markdownCell('## Analysis'),
			markdownCell('Some notes about the analysis.'),
			codeCell('df.describe()', 'python'),
			markdownCell('# Conclusion'),
		]);

		const serialized = serializeNotebook(notebook);
		const roundTripped = await deserialize(serialized);

		assert.strictEqual(roundTripped.cells.length, 6);
		// Check cell types
		assert.strictEqual(roundTripped.cells[0].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(roundTripped.cells[1].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(roundTripped.cells[2].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(roundTripped.cells[3].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(roundTripped.cells[4].kind, vscode.NotebookCellKind.Code);
		assert.strictEqual(roundTripped.cells[5].kind, vscode.NotebookCellKind.Markup);
	});

	test('should round-trip document with frontmatter', async () => {
		const original = '---\ntitle: Test Document\nauthor: Test Author\n---\n\n# Content\n\n```{python}\nprint("hello")\n```\n';
		const notebook = await deserialize(original);
		const serialized = serializeNotebook(notebook);
		const roundTripped = await deserialize(serialized);

		// Should have frontmatter, markdown, and code cells
		assert.strictEqual(roundTripped.cells.length, 3);
		assert.strictEqual(roundTripped.cells[0].metadata?.qmdCellType, 'frontmatter');
		assert.ok(roundTripped.cells[0].value.includes('title: Test Document'));
		assert.ok(roundTripped.cells[0].value.includes('author: Test Author'));
		assert.strictEqual(roundTripped.cells[1].kind, vscode.NotebookCellKind.Markup);
		assert.strictEqual(roundTripped.cells[2].kind, vscode.NotebookCellKind.Code);
	});

	test('should preserve frontmatter formatting on round-trip', async () => {
		const original = '---\n# Comment preserved\ntitle: "Test"\nitems:\n  - one\n  - two\n---\n\nContent';
		const notebook = await deserialize(original);
		const serialized = serializeNotebook(notebook);

		// Should preserve YAML comments and formatting
		assert.ok(serialized.includes('# Comment preserved'));
		assert.ok(serialized.includes('title: "Test"'));
		assert.ok(serialized.includes('items:'));
		assert.ok(serialized.includes('  - one'));
		assert.ok(serialized.includes('  - two'));
	});

	test('should not create frontmatter cell when document has none', async () => {
		const original = '# Just content\n\n```{python}\nx = 1\n```\n';
		const notebook = await deserialize(original);

		// No frontmatter cell
		assert.notStrictEqual(notebook.cells[0].metadata?.qmdCellType, 'frontmatter');
		assert.strictEqual(notebook.cells[0].kind, vscode.NotebookCellKind.Markup);
	});

	test('should round-trip code block with id and label', async () => {
		const original = '```{python #fig-plot label="My Plot"}\nimport matplotlib\n```\n';
		const notebook = await deserialize(original);
		const serialized = serializeNotebook(notebook);

		assert.ok(serialized.includes('#fig-plot'), 'Should preserve id');
		assert.ok(serialized.includes('label="My Plot"'), 'Should preserve label keyval');
	});
});
