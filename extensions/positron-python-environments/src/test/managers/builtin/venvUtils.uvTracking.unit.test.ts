import * as assert from 'assert';
import * as sinon from 'sinon';
import * as persistentState from '../../../common/persistentState';
import {
    UV_ENVS_KEY,
    addUvEnvironment,
    clearUvEnvironments,
    getUvEnvironments,
    removeUvEnvironment,
} from '../../../managers/builtin/uvEnvironments';
import { clearVenvCache } from '../../../managers/builtin/venvUtils';

suite('venvUtils UV Environment Tracking', () => {
    let mockState: {
        get: sinon.SinonStub;
        set: sinon.SinonStub;
        clear: sinon.SinonStub;
    };
    let getWorkspacePersistentStateStub: sinon.SinonStub;

    setup(() => {
        // Create minimal mock state with only required methods
        mockState = {
            get: sinon.stub(),
            set: sinon.stub(),
            clear: sinon.stub(),
        };
        getWorkspacePersistentStateStub = sinon.stub(persistentState, 'getWorkspacePersistentState');
        getWorkspacePersistentStateStub.resolves(mockState);
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return empty array when no UV environments have been stored', async () => {
        // Mock - No stored environments
        mockState.get.withArgs(UV_ENVS_KEY).resolves(undefined);

        // Run
        const result = await getUvEnvironments();

        // Assert - Should return empty array for fresh state
        assert.deepStrictEqual(result, [], 'Should return empty array when no environments stored');
    });

    test('should return previously stored UV environments', async () => {
        // Mock - Existing stored environments
        const storedEnvs = ['/path/to/env1', '/path/to/env2'];
        mockState.get.withArgs(UV_ENVS_KEY).resolves(storedEnvs);

        // Run
        const result = await getUvEnvironments();

        // Assert - Should return stored environments
        assert.deepStrictEqual(result, storedEnvs, 'Should return all stored UV environments');
    });

    test('should add new environment to tracking list', async () => {
        // Mock - Existing environment list
        const existingEnvs = ['/path/to/env1'];
        const newEnvPath = '/path/to/env2';
        mockState.get.withArgs(UV_ENVS_KEY).resolves(existingEnvs);

        // Run
        await addUvEnvironment(newEnvPath);

        // Assert - Should store updated list with new environment
        const expectedList = ['/path/to/env1', '/path/to/env2'];
        assert.ok(mockState.set.calledWith(UV_ENVS_KEY, expectedList), 'Should add new environment to existing list');
    });

    test('should ignore duplicate environment additions', async () => {
        // Mock - Environment already exists in list
        const existingEnvs = ['/path/to/env1', '/path/to/env2'];
        const duplicateEnvPath = '/path/to/env1';
        mockState.get.withArgs(UV_ENVS_KEY).resolves(existingEnvs);

        // Run
        await addUvEnvironment(duplicateEnvPath);

        // Assert - Should not modify state for duplicates
        assert.ok(mockState.set.notCalled, 'Should not update storage when adding duplicate environment');
    });

    test('should remove specified environment from tracking list', async () => {
        // Mock - List with multiple environments
        const existingEnvs = ['/path/to/env1', '/path/to/env2'];
        const envToRemove = '/path/to/env1';
        mockState.get.withArgs(UV_ENVS_KEY).resolves(existingEnvs);

        // Run
        await removeUvEnvironment(envToRemove);

        // Assert - Should store filtered list without removed environment
        const expectedList = ['/path/to/env2'];
        assert.ok(
            mockState.set.calledWith(UV_ENVS_KEY, expectedList),
            'Should remove specified environment from tracking list',
        );
    });

    test('should clear all tracked UV environments', async () => {
        // Mock - (no setup needed for clear operation)

        // Run
        await clearUvEnvironments();

        // Assert - Should reset to empty list
        assert.ok(mockState.set.calledWith(UV_ENVS_KEY, []), 'Should clear all UV environments from tracking');
    });

    test('should include UV environments when clearing venv cache', async () => {
        // Mock - (no setup needed for clear operation)

        // Run
        await clearVenvCache();

        // Assert - Should clear UV environments as part of cache clearing
        assert.ok(mockState.clear.called, 'Should call clear on persistent state');
        const clearArgs = mockState.clear.getCall(0).args[0];
        assert.ok(
            Array.isArray(clearArgs) && clearArgs.includes(UV_ENVS_KEY),
            'Should include UV environments key in cache clearing',
        );
    });
});
