/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../base/test/browser/react.js';
import { useDisposableEffect } from '../../browser/useDisposableEffect.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

suite('useDisposableEffect', () => {
	const { render, unmount } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	test('calls effect on mount and disposes on unmount', () => {
		const dispose = sinon.spy();
		const effect = sinon.stub().returns({ dispose });

		const TestComponent = () => {
			useDisposableEffect(effect, []);
			return null;
		};

		render(<TestComponent />);
		sinon.assert.calledOnce(effect);
		sinon.assert.notCalled(dispose);

		unmount();

		sinon.assert.calledOnce(dispose);
	});

	test('disposes when dependencies change', () => {
		const dispose = sinon.spy();

		const TestComponent = ({ dep }: { dep: number }) => {
			useDisposableEffect(() => ({ dispose }), [dep]);
			return null;
		};

		render(<TestComponent dep={0} />);
		sinon.assert.notCalled(dispose);

		render(<TestComponent dep={1} />);
		sinon.assert.calledOnce(dispose);

		render(<TestComponent dep={2} />);
		sinon.assert.calledTwice(dispose);
	});

	test('handles effect returning undefined', () => {
		const TestComponent = () => {
			useDisposableEffect(() => undefined, []);
			return null;
		};

		// Should not throw.
		render(<TestComponent />);
	});

	test('uses latest effect callback via ref', () => {
		// Verifies that the effect ref captures the latest closure, so a
		// stale closure is never invoked when deps trigger re-execution.
		const dispose = sinon.spy();
		const effect = sinon.spy((dep: number): IDisposable => {
			// If stale closure was used, dep wouldn't match the call index
			assert.strictEqual(dep, effect.callCount - 1);
			return { dispose };
		});

		const TestComponent = ({ dep }: { dep: number }) => {
			useDisposableEffect(() => effect(dep), [dep]);
			return null;
		};

		render(<TestComponent dep={0} />);
		sinon.assert.calledOnce(effect);

		render(<TestComponent dep={1} />);
		sinon.assert.calledTwice(effect);
	});
});
