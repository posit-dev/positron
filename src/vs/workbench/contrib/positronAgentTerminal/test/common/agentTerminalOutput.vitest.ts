/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MAX_LINE_LENGTH, MAX_RETAINED_LINES, OutputLines, ShellStreamParser, ShellStreamToken, TRUNCATED_MARKER } from '../../common/agentTerminalOutput.js';

function parseAll(...chunks: string[]): ShellStreamToken[] {
	const parser = new ShellStreamParser();
	return chunks.flatMap(chunk => parser.parse(chunk));
}

function textOf(tokens: ShellStreamToken[]): string {
	return tokens.map(t => t.type === 'text' ? t.text : '').join('');
}

describe('ShellStreamParser', () => {
	it('finds the command boundaries and exit code', () => {
		expect(parseAll('$ ls\x1b]633;E;ls -la;abc\x07\x1b]633;C\x07out\n\x1b]633;D;2\x07')).toEqual([
			{ type: 'text', text: '$ ls' },
			{ type: 'commandLine', commandLine: 'ls -la' },
			{ type: 'executed' },
			{ type: 'text', text: 'out\n' },
			{ type: 'finished', exitCode: 2 },
		]);
	});

	it('accepts FinalTerm sequences ended by ST', () => {
		expect(parseAll('\x1b]133;C\x1b\\x\x1b]133;D\x1b\\')).toEqual([
			{ type: 'executed' },
			{ type: 'text', text: 'x' },
			{ type: 'finished', exitCode: undefined },
		]);
	});

	it('decodes escaped command lines', () => {
		expect(parseAll('\x1b]633;E;echo a\\x3bb \\\\n;n\x07')).toEqual([
			{ type: 'commandLine', commandLine: 'echo a;b \\n' },
		]);
	});

	it('removes escape sequences, including ones split across chunks', () => {
		const tokens = parseAll('\x1b[3', '1mred\x1b[0m \x1b]0;ti', 'tle\x07\x1b(Bplain\x1b]633;', 'D;0\x07');
		expect(textOf(tokens)).toBe('red plain');
		expect(tokens.at(-1)).toEqual({ type: 'finished', exitCode: 0 });
	});
});

describe('OutputLines', () => {
	it('splits lines and keeps the last state of a progress bar', () => {
		const output = new OutputLines();
		output.append('a\r\nb 10%\rb 100%\nc');
		expect(output.lineCount).toBe(3);
		expect(output.read(0, 10)).toEqual({ offset: 0, lines: ['a', 'b 100%', 'c'] });
	});

	it('drops the blank lines a shell writes before its prompt', () => {
		const output = new OutputLines();
		output.append('done\n\n%' + ' '.repeat(79) + '\r \r');
		output.end();
		expect(output.read(0, 10).lines).toEqual(['done']);
	});

	it('truncates long lines', () => {
		const output = new OutputLines();
		output.append('x'.repeat(MAX_LINE_LENGTH + 50));
		output.end();
		expect(output.read(0, 1).lines[0]).toBe('x'.repeat(MAX_LINE_LENGTH) + TRUNCATED_MARKER);
	});

	it('drops the oldest lines but keeps numbering from the start', () => {
		const output = new OutputLines();
		const total = MAX_RETAINED_LINES + 2_000;
		output.append(Array.from({ length: total }, (_, i) => `${i}\n`).join(''));
		expect(output.lineCount).toBe(total);
		expect(output.droppedLines).toBeGreaterThan(0);
		expect(output.read(0, 1)).toEqual({ offset: output.droppedLines, lines: [`${output.droppedLines}`] });
		expect(output.read(total - 1, 5)).toEqual({ offset: total - 1, lines: [`${total - 1}`] });
	});
});
