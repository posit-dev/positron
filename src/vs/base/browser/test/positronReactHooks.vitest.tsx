/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, renderHook } from '@testing-library/react';
import { ContextKeyService } from '../../../platform/contextkey/browser/contextKeyService.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoLeakedDisposables } from '../../../test/vitest/vitestUtils.js';
import { usePositronContextKey } from '../positronReactHooks.js';

// These tests pass a real ContextKeyService via the `service` override, so the
// hook never reads the React services context -- no provider or service mocking
// is required. A real service (not MockContextKeyService, whose
// onDidChangeContext is Event.None) is essential: the point of the hook is to
// re-render on actual context-key change events.
describe('usePositronContextKey', () => {
	const disposables = ensureNoLeakedDisposables();

	it('reads the current value and re-renders when the key changes', () => {
		const service = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const key = service.createKey<boolean>('test.flag', false);

		const { result, unmount } = renderHook(() => usePositronContextKey<boolean>('test.flag', true, service));
		expect(result.current).toBe(false);

		act(() => key.set(true));
		expect(result.current).toBe(true);

		// Unmount so the effect's onDidChangeContext listener is disposed before
		// the leak check (RTL auto-cleanup runs too late for the tracker).
		unmount();
	});

	it('does not re-render when watch is false', () => {
		const service = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const key = service.createKey<boolean>('test.flag', false);

		const { result } = renderHook(() => usePositronContextKey<boolean>('test.flag', false, service));
		act(() => key.set(true));

		expect(result.current).toBe(false);
	});

	it('observes the provided scoped service, isolated from its parent', () => {
		const root = disposables.add(new ContextKeyService(new TestConfigurationService()));
		const scoped = disposables.add(root.createScoped(document.createElement('div')));
		scoped.createKey<string>('scoped.value', 'child');

		// The scoped service sees its own key; the parent scope does not. This is
		// the behavior that motivates the `service` override (e.g. a notebook's
		// scopedContextKeyService).
		const fromScoped = renderHook(() => usePositronContextKey<string>('scoped.value', true, scoped));
		const fromRoot = renderHook(() => usePositronContextKey<string>('scoped.value', true, root));

		expect(fromScoped.result.current).toBe('child');
		expect(fromRoot.result.current).toBeUndefined();

		// Unmount so each effect's listener is disposed before the leak check.
		fromScoped.unmount();
		fromRoot.unmount();
	});
});
