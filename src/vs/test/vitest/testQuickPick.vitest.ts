/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IQuickPickItem, QuickInputHideReason } from '../../platform/quickinput/common/quickInput.js';
import { ensureNoLeakedDisposables } from './vitestUtils.js';
import { TestQuickPick } from './testQuickPick.js';

describe('TestQuickPick', () => {
	const disposables = ensureNoLeakedDisposables();

	it('starts with empty default state', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());

		expect(pick.title).toBeUndefined();
		expect(pick.items).toEqual([]);
		expect(pick.activeItems).toEqual([]);
		expect(pick.selectedItems).toEqual([]);
		expect(pick.canSelectMany).toBe(false);
		expect(pick.busy).toBe(false);
	});

	it('accept() sets selectedItems and fires onDidAccept', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());
		const acceptSpy = vi.fn();
		disposables.add(pick.onDidAccept(acceptSpy));

		const item: IQuickPickItem = { id: 'one', label: 'One' };
		pick.accept(item);

		expect(pick.activeItems).toEqual([item]);
		expect(pick.selectedItems).toEqual([item]);
		expect(acceptSpy).toHaveBeenCalledOnce();
	});

	it('cancel() fires onDidHide with Other by default', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());
		const hideSpy = vi.fn();
		disposables.add(pick.onDidHide(hideSpy));

		pick.cancel();

		expect(hideSpy).toHaveBeenCalledExactlyOnceWith({ reason: QuickInputHideReason.Other });
	});

	it('cancel() forwards the supplied reason', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());
		const hideSpy = vi.fn();
		disposables.add(pick.onDidHide(hideSpy));

		pick.cancel(QuickInputHideReason.Gesture);

		expect(hideSpy).toHaveBeenCalledExactlyOnceWith({ reason: QuickInputHideReason.Gesture });
	});

	it('hide() fires onDidHide so callers that hide(after-accept) get the resolve signal', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());
		const hideSpy = vi.fn();
		disposables.add(pick.onDidHide(hideSpy));

		pick.hide();

		expect(pick.hide).toHaveBeenCalledOnce();
		expect(hideSpy).toHaveBeenCalledOnce();
	});

	it('show() is a spy that does not fire any event by itself', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());
		const acceptSpy = vi.fn();
		const hideSpy = vi.fn();
		disposables.add(pick.onDidAccept(acceptSpy));
		disposables.add(pick.onDidHide(hideSpy));

		pick.show();

		expect(pick.show).toHaveBeenCalledOnce();
		expect(acceptSpy).not.toHaveBeenCalled();
		expect(hideSpy).not.toHaveBeenCalled();
	});

	it('asQuickPick() returns a proxy that delegates reads/writes to the underlying instance', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());
		const stub = pick.asQuickPick();

		stub.title = 'pick something';
		expect(pick.title).toBe('pick something');

		const items = [{ id: 'a', label: 'A' }];
		stub.items = items;
		expect(pick.items).toEqual(items);
	});

	it('asQuickPick() throws on reads of properties the double does not implement', () => {
		const pick = disposables.add(new TestQuickPick<IQuickPickItem>());
		const stub = pick.asQuickPick();

		// `step` is on IQuickPick but not implemented by TestQuickPick, so
		// stubInterface throws on read. Catches "helper grew a new
		// dependency" without us having to update every test.
		expect(() => stub.step).toThrow(/test read property 'step'/);
	});
});
