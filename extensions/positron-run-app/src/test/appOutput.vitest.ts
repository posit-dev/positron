/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AppOutput, MAX_PENDING_ESCAPE, ReadOptions } from '../appOutput';

/** Big enough not to limit a read. */
const NO_BUDGET = 1_000_000;

/** An output fed `chunks` in turn. */
function outputOf(...chunks: string[]): AppOutput {
	const output = new AppOutput();
	for (const chunk of chunks) {
		output.append(chunk);
	}
	return output;
}

/** The last 1,000 lines `output` keeps, as text. */
function text(output: AppOutput): string {
	return output.read({ lines: 1000 }, NO_BUDGET).text;
}

/** An output with lines `line 1` to `line <count>`. */
function numbered(count: number): AppOutput {
	const output = new AppOutput();
	for (let n = 1; n <= count; n++) {
		output.append(`line ${n}\n`);
	}
	return output;
}

/** What a read returns, without the text. */
function position(output: AppOutput, options: ReadOptions, budget = NO_BUDGET) {
	const { firstLine, lastLine, totalLines, droppedLines, moreBefore } = output.read(options, budget);
	return { firstLine, lastLine, totalLines, droppedLines, moreBefore };
}

describe('AppOutput', () => {
	describe('lines', () => {
		it('joins lines split across chunks, with either line ending', () => {
			expect(text(outputOf('Traceback (most', ' recent call last):\r\n  File "app', '.py"\nKeyError'))).toBe(
				'Traceback (most recent call last):\n  File "app.py"\nKeyError',
			);
		});

		it('keeps the line when a \\r\\n is split between chunks', () => {
			expect(text(outputOf('KeyError: API_KEY\r', '\nnext'))).toBe('KeyError: API_KEY\nnext');
		});

		it('keeps the last state of a line redrawn with \\r', () => {
			expect(text(outputOf('Loading  10%\r', 'Loading  50%\rLoading 100%\ndone\n'))).toBe('Loading 100%\ndone');
		});

		it('leaves a line as it was when \\r is the last thing printed', () => {
			expect(text(outputOf('abc\r'))).toBe('abc');
		});

		it('drops trailing whitespace, and does not count a line of only whitespace until it ends', () => {
			// zsh pads the end of a command's output with spaces.
			const output = outputOf('GET / 500  \n', ' '.repeat(45));

			expect({ text: text(output), totalLines: output.totalLines }).toEqual({ text: 'GET / 500', totalLines: 1 });
		});

		it('drops control characters other than tabs', () => {
			expect(text(outputOf('a\tb\x07c\x00d\n'))).toBe('a\tbcd');
		});
	});

	describe('escape sequences', () => {
		const cases = {
			'CSI': '\x1b[31;1m',
			'OSC 633 ending in BEL': '\x1b]633;C\x07',
			'OSC 8 ending in ESC \\': '\x1b]8;id=1;http://127.0.0.1:8000\x1b\\',
			'character set': '\x1b(B',
		};
		for (const [name, sequence] of Object.entries(cases)) {
			it(`strips ${name}, split at every position across two chunks`, () => {
				const printed = `Uvicorn running on ${sequence}http://127.0.0.1:8000${sequence} (Press CTRL+C)\n`;
				const start = printed.indexOf(sequence);
				for (let split = start; split <= start + sequence.length; split++) {
					expect(text(outputOf(printed.slice(0, split), printed.slice(split))), `split at ${split}`)
						.toBe('Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C)');
				}
			});
		}

		it('does not strip text between a hyperlink and a shell integration sequence', () => {
			expect(text(outputOf('\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\ text \x1b]633;D;0\x07end\n'))).toBe('link text end');
		});

		it('does not hold back later output behind an escape sequence that never ends', () => {
			const output = outputOf('before\n\x1b]8;;http://x', 'y'.repeat(MAX_PENDING_ESCAPE));
			output.append('after\n');

			expect(text(output)).toBe(`before\n8;;http://x${'y'.repeat(MAX_PENDING_ESCAPE)}after`);
		});

		it('keeps the text after an escape sequence that never ends, in a single chunk', () => {
			const traceback = Array.from({ length: 300 }, (_, i) => `  frame ${i + 1}`);
			const output = outputOf(`ok\n\x1b]bad\n${traceback.join('\n')}\nError: boom\n`);

			expect(text(output)).toBe(['ok', 'bad', ...traceback, 'Error: boom'].join('\n'));
		});
	});

	describe('limits', () => {
		it('keeps the most recent 10,000 lines, numbered over all the output', () => {
			const output = numbered(10_005);

			expect({
				...position(output, { before: 7, lines: 1 }),
				oldest: output.read({ before: 7, lines: 1 }, NO_BUDGET).text,
			}).toEqual({ firstLine: 6, lastLine: 6, totalLines: 10_005, droppedLines: 5, moreBefore: false, oldest: 'line 6' });
		});

		it('cuts a long line at 1,000 characters and marks it', () => {
			expect(text(outputOf('x'.repeat(5_000) + '\n'))).toBe('x'.repeat(1_000) + ' [truncated]');
		});

		it('cuts output that never ends a line, and marks it', () => {
			const output = new AppOutput();
			for (let i = 0; i < 100; i++) {
				output.append('x'.repeat(100));
			}

			expect(text(output)).toBe('x'.repeat(1_000) + ' [truncated]');
		});

		it('forgets that a line was cut when it is redrawn', () => {
			expect(text(outputOf('x'.repeat(2_000), '\rshort\n'))).toBe('short');
		});
	});

	describe('reading the most recent lines', () => {
		it('returns 100 lines by default', () => {
			const output = numbered(150);

			expect(position(output, {})).toEqual({ firstLine: 51, lastLine: 150, totalLines: 150, droppedLines: 0, moreBefore: true });
		});

		it('returns between 1 and 1,000 lines', () => {
			const output = numbered(1_500);

			expect([position(output, { lines: 0 }).firstLine, position(output, { lines: 5_000 }).firstLine]).toEqual([1_500, 501]);
		});

		it('counts the line being written as the newest', () => {
			const output = outputOf('Traceback (most recent call last):\n', '  File "app.py", line 1');

			expect(output.read({ lines: 1 }, NO_BUDGET)).toEqual({
				text: '  File "app.py", line 1',
				firstLine: 2,
				lastLine: 2,
				totalLines: 2,
				droppedLines: 0,
				moreBefore: true,
			});
		});

		it('returns nothing when nothing was printed', () => {
			expect(new AppOutput().read({}, NO_BUDGET)).toEqual({
				text: '',
				firstLine: 0,
				lastLine: 0,
				totalLines: 0,
				droppedLines: 0,
				moreBefore: false,
			});
		});
	});

	describe('reading before a line', () => {
		it('reads the lines before that line', () => {
			const output = numbered(10);
			const { text } = output.read({ before: 7, lines: 3 }, NO_BUDGET);

			expect({ text, ...position(output, { before: 7, lines: 3 }) }).toEqual({
				text: 'line 4\nline 5\nline 6',
				firstLine: 4,
				lastLine: 6,
				totalLines: 10,
				droppedLines: 0,
				moreBefore: true,
			});
		});

		it('returns nothing before the oldest kept line', () => {
			const output = numbered(10_010);

			expect([position(output, { before: 11 }), position(output, { before: 3 })]).toEqual(Array(2).fill({
				firstLine: 0, lastLine: 0, totalLines: 10_010, droppedLines: 10, moreBefore: false,
			}));
		});

		it('reads the most recent lines from past the end', () => {
			const output = numbered(10);

			expect(position(output, { before: 50, lines: 2 })).toEqual({
				firstLine: 9, lastLine: 10, totalLines: 10, droppedLines: 0, moreBefore: true,
			});
		});

		it('pages back to the oldest kept line with no gaps or repeats while the app keeps printing', () => {
			const output = numbered(10_100);
			let printed = 10_100;
			const pages: string[][] = [];

			let page = output.read({ lines: 1_000 }, NO_BUDGET);
			pages.unshift(page.text.split('\n'));
			while (page.moreBefore) {
				// The app prints more between reads, dropping the oldest lines.
				for (let i = 0; i < 50; i++) {
					output.append(`line ${++printed}\n`);
				}
				page = output.read({ before: page.firstLine, lines: 1_000 }, NO_BUDGET);
				pages.unshift(page.text.split('\n'));
			}

			const read = pages.flat();
			const oldestKept = printed - 10_000 + 1;
			expect(read).toEqual(Array.from({ length: 10_100 - oldestKept + 1 }, (_, i) => `line ${oldestKept + i}`));
		});
	});

	describe('budget', () => {
		const long = (n: number) => `${n}`.padEnd(500, '.');
		function longLines(): AppOutput {
			const output = new AppOutput();
			for (let n = 1; n <= 200; n++) {
				output.append(long(n) + '\n');
			}
			return output;
		}

		it('returns the newest lines that fit', () => {
			const result = longLines().read({ lines: 1000 }, 30_000);

			expect({ firstLine: result.firstLine, lastLine: result.lastLine, moreBefore: result.moreBefore, fits: result.text.length <= 30_000 })
				.toEqual({ firstLine: 142, lastLine: 200, moreBefore: true, fits: true });
		});

		it('returns the newest lines before a line that fit', () => {
			const result = longLines().read({ lines: 1000, before: 142 }, 30_000);

			expect({ firstLine: result.firstLine, lastLine: result.lastLine }).toEqual({ firstLine: 83, lastLine: 141 });
		});

		it('counts characters as they serialize in JSON', () => {
			const output = outputOf('"a"\n', '"b"\n');

			// Each line is 3 characters but 5 in a JSON string, and the newline between them is 2.
			expect(output.read({}, 12).text).toBe('"a"\n"b"');
			expect(output.read({}, 11).text).toBe('"b"');
		});

		it('always returns at least one line', () => {
			expect(longLines().read({}, 10).text).toBe(long(200));
		});
	});
});
