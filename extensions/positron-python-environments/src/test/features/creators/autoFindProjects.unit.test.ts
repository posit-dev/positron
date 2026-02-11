import assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import * as typmoq from 'typemoq';
import { Uri } from 'vscode';
import { PythonProject } from '../../../api';
import { timeout } from '../../../common/utils/asyncUtils';
import { createDeferred } from '../../../common/utils/deferred';
import * as winapi from '../../../common/window.apis';
import * as wapi from '../../../common/workspace.apis';
import { AutoFindProjects } from '../../../features/creators/autoFindProjects';
import { PythonProjectManager } from '../../../internal.api';

suite('Auto Find Project tests', () => {
    let findFilesStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let showQuickPickWithButtonsStub: sinon.SinonStub;
    let projectManager: typmoq.IMock<PythonProjectManager>;

    setup(() => {
        findFilesStub = sinon.stub(wapi, 'findFiles');
        showErrorMessageStub = sinon.stub(winapi, 'showErrorMessage');
        showQuickPickWithButtonsStub = sinon.stub(winapi, 'showQuickPickWithButtons');
        showQuickPickWithButtonsStub.callsFake((items) => items);

        projectManager = typmoq.Mock.ofType<PythonProjectManager>();
    });

    teardown(() => {
        sinon.restore();
    });

    test('No projects found', async () => {
        findFilesStub.resolves([]);

        const deferred = createDeferred();

        let errorShown = false;
        showErrorMessageStub.callsFake(() => {
            errorShown = true;
            deferred.resolve();
        });

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();
        assert.equal(result, undefined, 'Result should be undefined');

        await Promise.race([deferred.promise, timeout(100)]);
        assert.ok(errorShown, 'Error message should have been shown');
    });

    test('No projects found (undefined)', async () => {
        findFilesStub.resolves(undefined);

        const deferred = createDeferred();

        let errorShown = false;
        showErrorMessageStub.callsFake(() => {
            errorShown = true;
            deferred.resolve();
        });

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();
        assert.equal(result, undefined, 'Result should be undefined');

        await Promise.race([deferred.promise, timeout(100)]);
        assert.ok(errorShown, 'Error message should have been shown');
    });

    test('Projects found', async () => {
        findFilesStub.resolves([
            Uri.file('/usr/home/root/a/pyproject.toml'),
            Uri.file('/usr/home/root/b/pyproject.toml'),
        ]);

        projectManager.setup((pm) => pm.get(typmoq.It.isAny())).returns(() => undefined);

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();

        const expected: PythonProject[] = [
            {
                name: 'a',
                uri: Uri.file('/usr/home/root/a'),
            },
            {
                name: 'b',
                uri: Uri.file('/usr/home/root/b'),
            },
        ];

        assert.ok(Array.isArray(result), 'Result should be an array');
        assert.equal(result.length, expected.length, `Result should have ${expected.length} items`);

        expected.forEach((item) => {
            assert.ok(
                result.some((r) => r.name === item.name && r.uri.fsPath === item.uri.fsPath),
                'Item not found in result',
            );
        });
        result.forEach((item) => {
            assert.ok(
                expected.some((r) => r.name === item.name && r.uri.fsPath === item.uri.fsPath),
                'Item not found in expected',
            );
        });
    });

    test('Projects found (with duplicates)', async () => {
        findFilesStub.resolves([
            Uri.file('/usr/home/root/a/pyproject.toml'),
            Uri.file('/usr/home/root/b/pyproject.toml'),
            Uri.file('/usr/home/root/c/pyproject.toml'),
            Uri.file('/usr/home/root/d/pyproject.toml'),
        ]);

        projectManager
            .setup((pm) => pm.get(typmoq.It.isAny()))
            .returns((uri) => {
                const basename = path.basename(uri.fsPath);
                if (basename === 'pyproject.toml') {
                    const parent = path.dirname(uri.fsPath);
                    const name = path.basename(parent);
                    if (name === 'a' || name === 'd') {
                        return { name, uri: Uri.file(parent) };
                    }
                }
            });

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();

        const expected: PythonProject[] = [
            {
                name: 'b',
                uri: Uri.file('/usr/home/root/b'),
            },
            {
                name: 'c',
                uri: Uri.file('/usr/home/root/c'),
            },
        ];

        assert.ok(Array.isArray(result), 'Result should be an array');
        assert.equal(result.length, expected.length, `Result should have ${expected.length} items`);

        expected.forEach((item) => {
            assert.ok(
                result.some((r) => r.name === item.name && r.uri.fsPath === item.uri.fsPath),
                'Item not found in result',
            );
        });
        result.forEach((item) => {
            assert.ok(
                expected.some((r) => r.name === item.name && r.uri.fsPath === item.uri.fsPath),
                'Item not found in expected',
            );
        });
    });

    test('Projects found (with all duplicates)', async () => {
        findFilesStub.resolves([
            Uri.file('/usr/home/root/a/pyproject.toml'),
            Uri.file('/usr/home/root/b/pyproject.toml'),
            Uri.file('/usr/home/root/c/pyproject.toml'),
            Uri.file('/usr/home/root/d/pyproject.toml'),
        ]);

        projectManager
            .setup((pm) => pm.get(typmoq.It.isAny()))
            .returns((uri) => {
                const basename = path.basename(uri.fsPath);
                if (basename === 'pyproject.toml') {
                    const parent = path.dirname(uri.fsPath);
                    const name = path.basename(parent);
                    return { name, uri: Uri.file(parent) };
                }
            });

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();

        assert.equal(result, undefined, 'Result should be undefined');
    });

    test('Projects found no selection', async () => {
        findFilesStub.resolves([
            Uri.file('/usr/home/root/a/pyproject.toml'),
            Uri.file('/usr/home/root/b/pyproject.toml'),
        ]);

        projectManager.setup((pm) => pm.get(typmoq.It.isAny())).returns(() => undefined);

        showQuickPickWithButtonsStub.callsFake(() => []);

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();

        assert.equal(result, undefined, 'Result should be undefined');
    });

    test('Projects found with no selection (user hit escape in picker)', async () => {
        findFilesStub.resolves([
            Uri.file('/usr/home/root/a/pyproject.toml'),
            Uri.file('/usr/home/root/b/pyproject.toml'),
        ]);

        projectManager.setup((pm) => pm.get(typmoq.It.isAny())).returns(() => undefined);

        showQuickPickWithButtonsStub.callsFake(() => undefined);

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();

        assert.equal(result, undefined, 'Result should be undefined');
    });

    test('Projects found with selection', async () => {
        findFilesStub.resolves([
            Uri.file('/usr/home/root/a/pyproject.toml'),
            Uri.file('/usr/home/root/b/pyproject.toml'),
            Uri.file('/usr/home/root/c/pyproject.toml'),
            Uri.file('/usr/home/root/d/pyproject.toml'),
        ]);

        projectManager
            .setup((pm) => pm.get(typmoq.It.isAny()))
            .returns((uri) => {
                const basename = path.basename(uri.fsPath);
                if (basename === 'pyproject.toml') {
                    const parent = path.dirname(uri.fsPath);
                    const name = path.basename(parent);
                    if (name === 'c') {
                        return { name, uri: Uri.file(parent) };
                    }
                }
            });

        showQuickPickWithButtonsStub.callsFake((items) => {
            return [items[0], items[2]];
        });

        const expected: PythonProject[] = [
            {
                name: 'a',
                uri: Uri.file('/usr/home/root/a'),
            },
            {
                name: 'd',
                uri: Uri.file('/usr/home/root/d'),
            },
        ];

        const autoFindProjects = new AutoFindProjects(projectManager.object);
        const result = await autoFindProjects.create();

        assert.ok(Array.isArray(result), 'Result should be an array');
        assert.equal(result.length, expected.length, `Result should have ${expected.length} items`);

        expected.forEach((item) => {
            assert.ok(
                result.some((r) => r.name === item.name && r.uri.fsPath === item.uri.fsPath),
                'Item not found in result',
            );
        });
        result.forEach((item) => {
            assert.ok(
                expected.some((r) => r.name === item.name && r.uri.fsPath === item.uri.fsPath),
                'Item not found in expected',
            );
        });
    });
});
