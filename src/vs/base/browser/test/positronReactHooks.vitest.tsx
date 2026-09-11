/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, renderHook } from '@testing-library/react';
import { ContextKeyService } from '../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService, RawContextKey } from '../../../platform/contextkey/common/contextkey.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoLeakedDisposables } from '../../../test/vitest/vitestUtils.js';
import { useBusyIndicator, useScopedContextKey } from '../positronReactHooks.js';

// These tests cover useScopedContextKey, the core shared by useContextKey and
// useContextKeyFromString. Passing the service explicitly means no React
// services provider is needed. A real ContextKeyService (not MockContextKeyService,
// whose onDidChangeContext is Event.None) is essential: the point of the hook is
// to re-render on actual context-key change events.
describe('useScopedContextKey', () => {
	const disposables = ensureNoLeakedDisposables();

	it('reads the current value and re-renders when the key changes', () => {
		const service = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const rawKey = new RawContextKey<boolean>('test.flag', false);
		const key = rawKey.bindTo(service);

		const { result, unmount } = renderHook(() => useScopedContextKey(rawKey, service));
		expect(result.current).toBe(false);

		act(() => key.set(true));
		expect(result.current).toBe(true);

		// Unmount so the effect's onDidChangeContext listener is disposed before
		// the leak check (RTL auto-cleanup runs too late for the tracker).
		unmount();
	});

	it('yields undefined while the service is unavailable, then reads once it is provided', () => {
		const service = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const rawKey = new RawContextKey<boolean>('test.flag', false);
		rawKey.bindTo(service).set(true);

		const { result, rerender, unmount } = renderHook(
			({ svc }: { svc: IContextKeyService | undefined }) => useScopedContextKey(rawKey, svc),
			{ initialProps: { svc: undefined as IContextKeyService | undefined } }
		);
		expect(result.current).toBeUndefined();

		// Once the service becomes available, the effect re-reads the value.
		rerender({ svc: service });
		expect(result.current).toBe(true);

		unmount();
	});

	it('observes the provided scoped service, isolated from its parent', () => {
		const root = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const scoped = disposables.add(root.createScoped(document.createElement('div')));
		const rawKey = new RawContextKey<string>('scoped.value', undefined);
		rawKey.bindTo(scoped).set('child');

		// The scoped service sees its own key; the parent scope does not. This is
		// the behavior that motivates useScopedContextKey (e.g. a notebook's
		// scopedContextKeyService).
		const fromScoped = renderHook(() => useScopedContextKey(rawKey, scoped));
		const fromRoot = renderHook(() => useScopedContextKey(rawKey, root));

		expect(fromScoped.result.current).toBe('child');
		expect(fromRoot.result.current).toBeUndefined();

		fromScoped.unmount();
		fromRoot.unmount();
	});
});

// Fake timers throughout: the hook's whole behavior is what happens at the delay and minimum
// boundaries, so the tests step time rather than wait for it.
describe('useBusyIndicator', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('shows nothing at all for an operation that finishes inside the delay', () => {
		const { result, rerender, unmount } = renderHook(
			({ busy }: { busy: boolean }) => useBusyIndicator(busy, 250, 400),
			{ initialProps: { busy: true } }
		);
		expect(result.current).toBe(false);

		// Finished at 100ms, well inside the delay. The pending timeout is torn down with the effect,
		// so the indicator is never raised and the icon never swaps.
		act(() => { vi.advanceTimersByTime(100); });
		rerender({ busy: false });
		act(() => { vi.advanceTimersByTime(1000); });
		expect(result.current).toBe(false);

		unmount();
	});

	it('holds the indicator for its minimum once an operation runs past the delay', () => {
		const { result, rerender, unmount } = renderHook(
			({ busy }: { busy: boolean }) => useBusyIndicator(busy, 250, 400),
			{ initialProps: { busy: true } }
		);

		// Past the delay, so the indicator goes up.
		act(() => { vi.advanceTimersByTime(250); });
		const shownAfterDelay = result.current;

		// Finishing 10ms later would blink it straight back out, so it stays for the rest of its
		// minimum and no longer.
		rerender({ busy: false });
		act(() => { vi.advanceTimersByTime(10); });
		const shownJustAfterFinishing = result.current;
		act(() => { vi.advanceTimersByTime(400); });

		expect({ shownAfterDelay, shownJustAfterFinishing, shownAfterMinimum: result.current })
			.toEqual({ shownAfterDelay: true, shownJustAfterFinishing: true, shownAfterMinimum: false });

		unmount();
	});
});
