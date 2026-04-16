/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import sinon from 'sinon';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { useDisposableEffect } from '../../browser/useDisposableEffect.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

describe('useDisposableEffect', () => {
	ensureNoLeakedDisposables();
	const rtl = setupRTLRenderer();

	it('calls effect on mount and disposes on unmount', () => {
		const dispose = sinon.spy();
		const effect = sinon.stub().returns({ dispose });

		const TestComponent = () => {
			useDisposableEffect(effect, []);
			return null;
		};

		const { unmount } = rtl.render(<TestComponent />);
		sinon.assert.calledOnce(effect);
		sinon.assert.notCalled(dispose);

		unmount();

		sinon.assert.calledOnce(dispose);
	});

	it('disposes when dependencies change', () => {
		const dispose = sinon.spy();

		const TestComponent = ({ dep }: { dep: number }) => {
			useDisposableEffect(() => ({ dispose }), [dep]);
			return null;
		};

		const { rerender } = rtl.render(<TestComponent dep={0} />);
		sinon.assert.notCalled(dispose);

		rerender(<TestComponent dep={1} />);
		sinon.assert.calledOnce(dispose);

		rerender(<TestComponent dep={2} />);
		sinon.assert.calledTwice(dispose);
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
		const dispose = sinon.spy();
		const effect = sinon.spy((dep: number): IDisposable => {
			// If stale closure was used, dep wouldn't match the call index
			expect(dep).toBe(effect.callCount - 1);
			return { dispose };
		});

		const TestComponent = ({ dep }: { dep: number }) => {
			useDisposableEffect(() => effect(dep), [dep]);
			return null;
		};

		const { rerender } = rtl.render(<TestComponent dep={0} />);
		sinon.assert.calledOnce(effect);

		rerender(<TestComponent dep={1} />);
		sinon.assert.calledTwice(effect);
	});
});
