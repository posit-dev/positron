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
import { useScopedContextKey } from '../positronReactHooks.js';

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
