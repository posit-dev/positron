import * as assert from 'assert';
import * as sinon from 'sinon';
import { TemporaryStateManager } from '../../../features/views/temporaryStateManager';

suite('TemporaryStateManager', () => {
    let manager: TemporaryStateManager;

    setup(() => {
        manager = new TemporaryStateManager();
    });

    teardown(() => {
        manager.dispose();
        sinon.restore();
    });

    test('hasState returns false for items without state', () => {
        assert.strictEqual(manager.hasState('item-1', 'copied'), false);
        assert.strictEqual(manager.hasState('item-2', 'selected'), false);
    });

    test('setState sets the state on an item', () => {
        manager.setState('item-1', 'copied');
        assert.strictEqual(manager.hasState('item-1', 'copied'), true);
        assert.strictEqual(manager.hasState('item-1', 'selected'), false);
        assert.strictEqual(manager.hasState('item-2', 'copied'), false);
    });

    test('setState fires onDidChangeState event', () => {
        const spy = sinon.spy();
        manager.onDidChangeState(spy);

        manager.setState('item-1', 'copied');

        assert.strictEqual(spy.calledOnce, true);
        assert.deepStrictEqual(spy.firstCall.args[0], { itemId: 'item-1', stateKey: 'copied' });
    });

    test('multiple states can be set on the same item', () => {
        manager.setState('item-1', 'copied');
        manager.setState('item-1', 'selected');

        assert.strictEqual(manager.hasState('item-1', 'copied'), true);
        assert.strictEqual(manager.hasState('item-1', 'selected'), true);
    });

    test('clearState removes specific state', () => {
        manager.setState('item-1', 'copied');
        manager.setState('item-1', 'selected');

        manager.clearState('item-1', 'copied');

        assert.strictEqual(manager.hasState('item-1', 'copied'), false);
        assert.strictEqual(manager.hasState('item-1', 'selected'), true);
    });

    test('setting same state again resets timeout', () => {
        const spy = sinon.spy();
        manager.onDidChangeState(spy);

        manager.setState('item-1', 'copied');
        assert.strictEqual(spy.callCount, 1);

        manager.setState('item-1', 'copied');
        assert.strictEqual(spy.callCount, 2);
        assert.strictEqual(manager.hasState('item-1', 'copied'), true);
    });

    test('dispose clears all state without errors', () => {
        manager.setState('item-1', 'copied');
        manager.setState('item-2', 'selected');
        manager.dispose();
    });

    suite('updateContextValue', () => {
        test('adds state key when state is set', () => {
            manager.setState('item-1', 'copied');
            const result = manager.updateContextValue('item-1', 'pythonEnvironment', ['copied']);
            assert.strictEqual(result, 'pythonEnvironment;copied');
        });

        test('removes state key when state is not set', () => {
            const result = manager.updateContextValue('item-1', 'pythonEnvironment;copied', ['copied']);
            assert.strictEqual(result, 'pythonEnvironment');
        });

        test('handles multiple state keys', () => {
            manager.setState('item-1', 'copied');
            manager.setState('item-1', 'selected');
            const result = manager.updateContextValue('item-1', 'pythonEnvironment', ['copied', 'selected']);
            assert.strictEqual(result, 'pythonEnvironment;copied;selected');
        });

        test('only adds states that are set', () => {
            manager.setState('item-1', 'selected');
            const result = manager.updateContextValue('item-1', 'pythonEnvironment', ['copied', 'selected']);
            assert.strictEqual(result, 'pythonEnvironment;selected');
        });

        test('does not duplicate existing state', () => {
            manager.setState('item-1', 'copied');
            const result = manager.updateContextValue('item-1', 'pythonEnvironment;copied', ['copied']);
            assert.strictEqual(result, 'pythonEnvironment;copied');
        });
    });
});
