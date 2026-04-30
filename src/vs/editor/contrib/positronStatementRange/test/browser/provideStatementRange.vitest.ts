/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { errorHandler } from '../../../../../base/common/errors.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Position } from '../../../../common/core/position.js';
import { LanguageFeatureRegistry } from '../../../../common/languageFeatureRegistry.js';
import { StatementRangeKind, StatementRangeProvider, StatementRangeRejectionKind } from '../../../../common/languages.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { provideStatementRange } from '../../browser/provideStatementRange.js';

describe('provideStatementRange', () => {
	let disposables: DisposableStore;
	let registry: LanguageFeatureRegistry<StatementRangeProvider>;

	ensureNoLeakedDisposables();

	beforeEach(() => {
		disposables = new DisposableStore();
		registry = new LanguageFeatureRegistry<StatementRangeProvider>();
	});

	afterEach(() => {
		disposables.dispose();
	});

	it('returns `undefined` when no providers are registered', async () => {
		const model = disposables.add(createTextModel('x = 1', 'testLang'));
		const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);
		expect(result).toBeUndefined();
	});

	it('returns a successful result from a provider', async () => {
		disposables.add(registry.register('testLang', {
			provideStatementRange(_model, _position, _token) {
				return {
					kind: StatementRangeKind.Success,
					range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
				};
			}
		}));

		const model = disposables.add(createTextModel('x = 1', 'testLang'));
		const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);

		expect(result).toBeDefined();
		expect(result?.kind).toBe(StatementRangeKind.Success);
		expect(result?.range).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
	});

	it('returns a successful result with `code`', async () => {
		disposables.add(registry.register('testLang', {
			provideStatementRange(_model, _position, _token) {
				return {
					kind: StatementRangeKind.Success,
					range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
					code: '1 + 1',
				};
			}
		}));

		const model = disposables.add(createTextModel('1 + 1', 'testLang'));
		const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);

		expect(result).toBeDefined();
		expect(result?.kind).toBe(StatementRangeKind.Success);
		expect(result?.code).toBe('1 + 1');
	});

	it('returns a syntax rejection from a provider', async () => {
		disposables.add(registry.register('testLang', {
			provideStatementRange(_model, _position, _token) {
				return {
					kind: StatementRangeKind.Rejection,
					rejectionKind: StatementRangeRejectionKind.Syntax,
					line: 0,
				};
			}
		}));

		const model = disposables.add(createTextModel('x = ', 'testLang'));
		const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);

		expect(result).toBeDefined();
		expect(result?.kind).toBe(StatementRangeKind.Rejection);
		expect(result?.rejectionKind).toBe(StatementRangeRejectionKind.Syntax);
		expect(result?.line).toBe(0);
	});

	it('swallows provider error and returns undefined', async () => {
		const origErrorHandler = errorHandler.getUnexpectedErrorHandler();
		errorHandler.setUnexpectedErrorHandler(() => { });
		try {
			disposables.add(registry.register('testLang', {
				provideStatementRange(_model, _position, _token) {
					throw new Error('provider crashed');
				}
			}));

			const model = disposables.add(createTextModel('x = 1', 'testLang'));
			const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);

			expect(result).toBeUndefined();
		} finally {
			errorHandler.setUnexpectedErrorHandler(origErrorHandler);
		}
	});

	it('swallows provider error and falls through to next provider', async () => {
		const origErrorHandler = errorHandler.getUnexpectedErrorHandler();
		errorHandler.setUnexpectedErrorHandler(() => { });
		try {
			disposables.add(registry.register('testLang', {
				provideStatementRange(_model, _position, _token) {
					throw new Error('provider crashed');
				}
			}));
			disposables.add(registry.register('testLang', {
				provideStatementRange(_model, _position, _token) {
					return {
						kind: StatementRangeKind.Success,
						range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
					};
				}
			}));

			const model = disposables.add(createTextModel('x = 1', 'testLang'));
			const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);

			expect(result).toBeDefined();
			expect(result?.kind).toBe(StatementRangeKind.Success);
		} finally {
			errorHandler.setUnexpectedErrorHandler(origErrorHandler);
		}
	});

	it('does not match providers for a different language', async () => {
		disposables.add(registry.register('otherLang', {
			provideStatementRange(_model, _position, _token) {
				return {
					kind: StatementRangeKind.Success,
					range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
				};
			}
		}));

		const model = disposables.add(createTextModel('x = 1', 'testLang'));
		const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);

		expect(result).toBeUndefined();
	});
});
