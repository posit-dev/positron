/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { stubInterface } from './stubInterface.js';

interface IFoo {
	name: string;
	getCount(): number;
	update(n: number): void;
}

describe('stubInterface', () => {
	it('returns overridden values', () => {
		const foo = stubInterface<IFoo>({
			name: 'hello',
			getCount: () => 42,
		});

		expect(foo.name).toBe('hello');
		expect(foo.getCount()).toBe(42);
	});

	it('throws on unset property reads', () => {
		const foo = stubInterface<IFoo>({ name: 'hello' });

		expect(() => foo.getCount()).toThrow(/test read property 'getCount'/);
		expect(() => foo.update(1)).toThrow(/test read property 'update'/);
	});

	it('treats explicit undefined as set (does not throw)', () => {
		const foo = stubInterface<IFoo>({ name: undefined as unknown as string });

		expect(foo.name).toBe(undefined);
	});

	it('returns undefined for well-known symbols without throwing', () => {
		// Proxy property lookup is exercised by language-level internals like
		// console.log / for...of / Promise.resolve. Those paths must not throw.
		const foo = stubInterface<IFoo>({});

		expect((foo as unknown as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive]).toBe(undefined);
		expect((foo as unknown as { [Symbol.iterator]?: unknown })[Symbol.iterator]).toBe(undefined);
	});

	it('is not awaited as a thenable', async () => {
		// If .then threw, `await stub` would fail. Silent undefined keeps
		// Promise detection correct.
		const foo = stubInterface<IFoo>({ name: 'hi' });

		const result = await Promise.resolve(foo);
		expect(result.name).toBe('hi');
	});

	it('supports default empty overrides', () => {
		const foo = stubInterface<IFoo>();

		expect(() => foo.name).toThrow(/test read property 'name'/);
	});

	it('responds to `in` based on overrides', () => {
		const foo = stubInterface<IFoo>({ name: 'hello' });

		// eslint-disable-next-line local/code-no-in-operator -- testing the Proxy `has` trap
		expect('name' in foo).toBe(true);
		// eslint-disable-next-line local/code-no-in-operator -- testing the Proxy `has` trap
		expect('getCount' in foo).toBe(false);
	});

	describe('in a failing assertion message', () => {
		// The failure message Vitest throws, or undefined if the assertion passed.
		function failureMessage(assertion: () => void): string | undefined {
			try {
				assertion();
				return undefined;
			} catch (err) {
				return (err as Error).message;
			}
		}

		it.each([
			['toBe', (foo: IFoo) => expect(foo).toBe({ name: 'other' })],
			['toEqual', (foo: IFoo) => expect(foo).toEqual({ name: 'other' })],
			['toHaveBeenCalledWith', (foo: IFoo) => {
				const fn = vi.fn();
				fn(foo);
				expect(fn).toHaveBeenCalledWith({ name: 'other' });
			}],
			['toHaveBeenCalledWith, stub as the expected value', (foo: IFoo) => {
				const fn = vi.fn();
				fn({ name: 'other' });
				expect(fn).toHaveBeenCalledWith(foo);
			}],
		])('%s shows the real failure, not a stub error', (_name, assertion) => {
			const foo = stubInterface<IFoo>({ name: 'hello' });

			const message = failureMessage(() => assertion(foo));

			expect(message).toBeDefined();
			expect(message).not.toMatch(/stubInterface/);
			expect(message).toMatch(/hello/);
		});
	});
});
