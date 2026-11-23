/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { act, screen } from '@testing-library/react';
import { equals } from '../../common/arrays.js';
import { Emitter } from '../../common/event.js';
import { useExternalValue } from '../../browser/useExternalValue.js';
import { setupRTLRenderer } from '../../../test/vitest/reactTestingLibrary.js';

/**
 * A stand-in for a service: a value plus an event that fires when it changes.
 */
class TestStore {
	private readonly _onDidChange = new Emitter<string[]>();
	readonly onDidChange = this._onDidChange.event;
	private _items: string[] = [];

	/** Builds a new array on each read, like `positronConsoleService.positronConsoleInstances`. */
	get items(): string[] {
		return [...this._items];
	}

	add(item: string) {
		this._items.push(item);
		this._onDidChange.fire(this.items);
	}

	get hasListeners() {
		return this._onDidChange.hasListeners();
	}

	dispose() {
		this._onDidChange.dispose();
	}
}

/** Reads the store the way most Positron components do today. */
const OldPattern = ({ store }: { store: TestStore }) => {
	const [items, setItems] = useState(store.items);
	useEffect(() => {
		const disposable = store.onDidChange(setItems);
		return () => disposable.dispose();
	}, [store]);
	return <div data-testid='old'>{items.join(',')}</div>;
};

/** Reads the store through the new hook. */
const NewPattern = ({ store }: { store: TestStore }) => {
	const items = useExternalValue(store.onDidChange, () => store.items, equals);
	return <div data-testid='new'>{items.join(',')}</div>;
};

/**
 * Changes the store while it renders. React renders this after the components before it but
 * runs their effects only after it, so the change lands in the gap between those components
 * reading the store and subscribing to it. That is the timing of console restore at startup.
 */
const ChangeDuringRender = ({ store, item }: { store: TestStore; item: string }) => {
	useState(() => store.add(item));
	return null;
};

describe('useExternalValue', () => {
	const rtl = setupRTLRenderer();
	let store: TestStore;

	beforeEach(() => {
		store = new TestStore();
		store.add('a');
	});

	afterEach(() => store.dispose());

	it('keeps a change made between render and subscribe, which the useState pattern loses', () => {
		rtl.render(
			<>
				<OldPattern store={store} />
				<NewPattern store={store} />
				<ChangeDuringRender item='b' store={store} />
			</>
		);

		expect(store.items).toEqual(['a', 'b']);
		expect(screen.getByTestId('old')).toHaveTextContent(/^a$/);
		expect(screen.getByTestId('new')).toHaveTextContent(/^a,b$/);
	});

	it('updates when the store fires its change event', () => {
		rtl.render(<NewPattern store={store} />);

		act(() => store.add('b'));

		expect(screen.getByTestId('new')).toHaveTextContent(/^a,b$/);
	});

	it('returns the same array while the contents are equal, so a new array per read does not loop', () => {
		const seen: string[][] = [];
		const Recorder = ({ tick }: { tick: number }) => {
			seen.push(useExternalValue(store.onDidChange, () => store.items, equals));
			return <div>{tick}</div>;
		};

		const { rerender } = rtl.render(<Recorder tick={0} />);
		rerender(<Recorder tick={1} />);

		expect(seen.length).toBeGreaterThan(1);
		expect(seen.every(items => items === seen[0])).toBe(true);
	});

	it('stops listening when the component unmounts', () => {
		const { unmount } = rtl.render(<NewPattern store={store} />);
		expect(store.hasListeners).toBe(true);

		unmount();

		expect(store.hasListeners).toBe(false);
	});
});
