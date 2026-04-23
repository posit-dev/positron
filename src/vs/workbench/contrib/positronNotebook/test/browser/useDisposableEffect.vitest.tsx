/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { useDisposableEffect } from '../../browser/useDisposableEffect.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

describe('useDisposableEffect', () => {
	const rtl = setupRTLRenderer();

	it('calls effect on mount and disposes on unmount', () => {
		const dispose = vi.fn();
		const effect = vi.fn().mockReturnValue({ dispose });

		const TestComponent = () => {
			useDisposableEffect(effect, []);
			return null;
		};

		const { unmount } = rtl.render(<TestComponent />);
		expect(effect).toHaveBeenCalledOnce();
		expect(dispose).not.toHaveBeenCalled();

		unmount();

		expect(dispose).toHaveBeenCalledOnce();
	});

	it('disposes when dependencies change', () => {
		const dispose = vi.fn();

		const TestComponent = ({ dep }: { dep: number }) => {
			useDisposableEffect(() => ({ dispose }), [dep]);
			return null;
		};

		const { rerender } = rtl.render(<TestComponent dep={0} />);
		expect(dispose).not.toHaveBeenCalled();

		rerender(<TestComponent dep={1} />);
		expect(dispose).toHaveBeenCalledOnce();

		rerender(<TestComponent dep={2} />);
		expect(dispose).toHaveBeenCalledTimes(2);
	});

	it('handles effect returning undefined', () => {
		const TestComponent = () => {
			useDisposableEffect(() => undefined, []);
			return null;
		};

		// Should not throw.
		rtl.render(<TestComponent />);
	});

	it('uses latest effect callback via ref', () => {
		// Verifies that the effect ref captures the latest closure, so a
		// stale closure is never invoked when deps trigger re-execution.
		const dispose = vi.fn();
		const effect = vi.fn((dep: number): IDisposable => {
			// If stale closure was used, dep wouldn't match the call index
			expect(dep).toBe(effect.mock.calls.length - 1);
			return { dispose };
		});

		const TestComponent = ({ dep }: { dep: number }) => {
			useDisposableEffect(() => effect(dep), [dep]);
			return null;
		};

		const { rerender } = rtl.render(<TestComponent dep={0} />);
		expect(effect).toHaveBeenCalledOnce();

		rerender(<TestComponent dep={1} />);
		expect(effect).toHaveBeenCalledTimes(2);
	});
});
