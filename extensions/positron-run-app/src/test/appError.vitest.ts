/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AppError, fitError, keepError, toAppError } from '../appError';

/** Big enough not to limit a read. */
const NO_BUDGET = 1_000_000;

/** An error with `count` frames, numbered from 1. */
function errorWithFrames(count: number): AppError {
	return { name: 'Error', message: 'boom', traceback: Array.from({ length: count }, (_, i) => `frame ${i + 1}`) };
}

describe('reading the error that ended a console execution', () => {
	it('takes the traceback from a runtime error\'s stack', () => {
		expect(toAppError({ name: 'KeyError', message: '\'API_KEY\'', stack: 'Traceback\n  File "app.R", line 3' })).toEqual({
			name: 'KeyError',
			message: '\'API_KEY\'',
			traceback: ['Traceback', '  File "app.R", line 3'],
		});
	});

	it('leaves out the JavaScript stack of an Error from failing to run the code', () => {
		expect(toAppError(new TypeError('No session'))).toEqual({ name: 'TypeError', message: 'No session', traceback: [] });
	});

	it('falls back to a generic name and the value itself for anything else', () => {
		expect([toAppError('gone'), toAppError(undefined)]).toEqual([
			{ name: 'Error', message: 'gone', traceback: [] },
			{ name: 'Error', message: 'undefined', traceback: [] },
		]);
	});
});

describe('keeping an app\'s error', () => {
	it('strips escapes and leaves a short error as it is', () => {
		const error = { name: '\x1b[31mKeyError\x1b[0m', message: '\'API_KEY\'', traceback: ['\x1b[1mTraceback\x1b[0m', '  File "app.py", line 3'] };

		expect(fitError(keepError(error), NO_BUDGET)).toEqual({
			name: 'KeyError',
			message: '\'API_KEY\'',
			traceback: ['Traceback', '  File "app.py", line 3'],
		});
	});

	it('cuts a long error message and long frames, and keeps the start and end of a long traceback', () => {
		const { traceback, message } = fitError(keepError({
			name: 'Error',
			message: 'm'.repeat(5_000),
			traceback: ['f'.repeat(5_000), ...Array.from({ length: 199 }, (_, i) => `frame ${i + 2}`)],
		}), NO_BUDGET);

		expect({
			message,
			frames: traceback.length,
			first: traceback[0],
			around: traceback.slice(9, 12),
			last: traceback.at(-1),
		}).toEqual({
			message: 'm'.repeat(1_000) + ' [truncated]',
			frames: 51,
			first: 'f'.repeat(1_000) + ' [truncated]',
			around: ['frame 10', '[150 frames left out]', 'frame 161'],
			last: 'frame 200',
		});
	});

	it('leaves out more frames from the middle to fit a budget, keeping the start and end', () => {
		const kept = keepError(errorWithFrames(200));
		const budget = JSON.stringify(fitError(kept, NO_BUDGET)).length / 2;

		const fitted = fitError(kept, budget);

		expect({
			fits: JSON.stringify(fitted).length <= budget,
			first: fitted.traceback[0],
			last: fitted.traceback.at(-1),
			leftOut: fitted.traceback.filter(frame => frame.endsWith('frames left out]')).length,
		}).toEqual({ fits: true, first: 'frame 1', last: 'frame 200', leftOut: 1 });
	});
});
