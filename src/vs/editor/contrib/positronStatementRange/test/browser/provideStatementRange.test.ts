/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { errorHandler } from '../../../../../base/common/errors.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Position } from '../../../../common/core/position.js';
import { LanguageFeatureRegistry } from '../../../../common/languageFeatureRegistry.js';
import { StatementRangeKind, StatementRangeProvider, StatementRangeRejectionKind } from '../../../../common/languages.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { provideStatementRange } from '../../browser/provideStatementRange.js';

suite('provideStatementRange', () => {
	let disposables: DisposableStore;
	let registry: LanguageFeatureRegistry<StatementRangeProvider>;

	setup(() => {
		disposables = new DisposableStore();
		registry = new LanguageFeatureRegistry<StatementRangeProvider>();
	});

	teardown(() => {
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns `undefined` when no providers are registered', async () => {
		const model = disposables.add(createTextModel('x = 1', 'testLang'));
		const result = await provideStatementRange(registry, model, new Position(1, 1), CancellationToken.None);
		assert.strictEqual(result, undefined);
	});

	test('returns a successful result from a provider', async () => {
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

		assert.ok(result);
		assert.strictEqual(result.kind, StatementRangeKind.Success);
		assert.deepStrictEqual(result.range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
	});

	test('returns a successful result with `code`', async () => {
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

		assert.ok(result);
		assert.strictEqual(result.kind, StatementRangeKind.Success);
		assert.strictEqual(result.code, '1 + 1');
	});

	test('returns a syntax rejection from a provider', async () => {
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

		assert.ok(result);
		assert.strictEqual(result.kind, StatementRangeKind.Rejection);
		assert.strictEqual(result.rejectionKind, StatementRangeRejectionKind.Syntax);
		assert.strictEqual(result.line, 0);
	});

	test('swallows provider error and returns undefined', async () => {
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

			assert.strictEqual(result, undefined);
		} finally {
			errorHandler.setUnexpectedErrorHandler(origErrorHandler);
		}
	});

	test('swallows provider error and falls through to next provider', async () => {
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

			assert.ok(result);
			assert.strictEqual(result.kind, StatementRangeKind.Success);
		} finally {
			errorHandler.setUnexpectedErrorHandler(origErrorHandler);
		}
	});

	test('does not match providers for a different language', async () => {
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

		assert.strictEqual(result, undefined);
	});
});
