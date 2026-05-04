/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { IQuickInputHideEvent, IQuickPick, IQuickPickItem, QuickInputHideReason, QuickPickInput } from '../../platform/quickinput/common/quickInput.js';
import { stubInterface } from './stubInterface.js';

/**
 * Test double for `IQuickPick<T>`. Implements the surface that test-driven
 * picker flows actually exercise -- settable state, the two events the helper
 * waits on (`onDidAccept` / `onDidHide`), `show` / `hide` spies, and a couple
 * of convenience methods for driving user actions. Properties not explicitly
 * implemented here throw on read (via `stubInterface`) when the test tries
 * to use them, so growing dependencies are caught instead of silently passing
 * `undefined`.
 *
 * Wire it into the `IQuickInputService` stub:
 *
 * ```ts
 * let pick: TestQuickPick<IQuickPickItem>;
 *
 * const ctx = createTestContainer()
 *     .withRuntimeServices()
 *     .stub(IQuickInputService, stubInterface<IQuickInputService>({
 *         createQuickPick: () => pick.asQuickPick(),
 *     }))
 *     .build();
 *
 * beforeEach(() => {
 *     pick = ctx.disposables.add(new TestQuickPick<IQuickPickItem>());
 * });
 *
 * it('resolves to the selected runtime', async () => {
 *     const promise = runHelperUnderTest();
 *     await vi.waitFor(() => expect(pick.show).toHaveBeenCalled());
 *
 *     pick.accept(pick.items.find(i => i.id === 'wanted')!);
 *     await expect(promise).resolves.toEqual(...);
 * });
 * ```
 *
 * If your test needs a property not implement here (e.g. `step`, `buttons`,
 * `onDidTriggerButton`), add it here. The goal is for this to stay reusable
 * as more pickers adopt it.
 */
export class TestQuickPick<T extends IQuickPickItem> extends Disposable {

	private readonly _onDidAccept = this._register(new Emitter<void>());
	private readonly _onDidHide = this._register(new Emitter<IQuickInputHideEvent>());
	private readonly _onDidChangeActive = this._register(new Emitter<readonly T[]>());
	private readonly _onDidChangeSelection = this._register(new Emitter<readonly T[]>());

	title: string | undefined;
	placeholder: string | undefined;
	description: string | undefined;
	canSelectMany = false;
	items: ReadonlyArray<QuickPickInput<T>> = [];
	activeItems: ReadonlyArray<T> = [];
	selectedItems: ReadonlyArray<T> = [];
	busy = false;
	enabled = true;
	matchOnDescription = false;
	matchOnDetail = false;
	matchOnLabel = true;
	sortByLabel = true;

	readonly onDidAccept = this._onDidAccept.event;
	readonly onDidHide = this._onDidHide.event;
	readonly onDidChangeActive = this._onDidChangeActive.event;
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	/** Spy: the helper calls `show()` once setup is complete. Tests typically
	 *  await `vi.waitFor(() => expect(pick.show).toHaveBeenCalled())` to
	 *  synchronize on "picker is open and ready for interaction." */
	readonly show = vi.fn();

	/** Spy: the helper calls `hide()` after accepting. We mirror the real
	 *  picker's behavior by firing `onDidHide` so the helper's hide-handler
	 *  (which runs the resolve flow) actually runs. */
	readonly hide = vi.fn((): void => {
		this._onDidHide.fire({ reason: QuickInputHideReason.Other });
	});

	/** Simulate the user accepting `item`: sets activeItems and selectedItems
	 *  (mirroring the real QuickPick's single-select on-accept behavior), then
	 *  fires onDidAccept. */
	accept(item: T): void {
		this.activeItems = [item];
		this.selectedItems = [item];
		this._onDidAccept.fire();
	}

	/** Simulate the user dismissing the picker. */
	cancel(reason: QuickInputHideReason = QuickInputHideReason.Other): void {
		this._onDidHide.fire({ reason });
	}

	/**
	 * Wrap this double in a `stubInterface`-backed `IQuickPick<T>` so that:
	 *   - The properties this class implements are reachable by the helper.
	 *   - Reads of properties this class does NOT implement throw with a
	 *     clear error (instead of returning `undefined` silently).
	 *
	 * Use in a `createQuickPick` stub:
	 *   `createQuickPick: () => pick.asQuickPick()`
	 */
	asQuickPick(): IQuickPick<T> {
		// `stubInterface` will complain about missing properties, so we have to
		//  cast `this` to `Partial<IQuickPick<T>>` to tell it "these properties
		//  are implemented, just not declared on the class." We then assert the
		//  full `IQuickPick<T>` return type to satisfy the `createQuickPick`
		//  contract.
		return stubInterface<IQuickPick<T>>(this as unknown as Partial<IQuickPick<T>>);
	}
}
