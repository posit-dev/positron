/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { listMissingPythonPackages, parsePythonImports } from '../../client/positron/missingPackages';
import { IPackageManager, PackageSession } from '../../client/positron/packages/types';

suite('parsePythonImports', () => {
    test('extracts top-level modules from import and from statements, ignoring aliases and relatives', () => {
        const code = [
            'import requests',
            'import os.path',
            'import numpy as np',
            'import pandas, sklearn',
            'from flask import Flask',
            'from foo.bar import baz',
            'from . import sibling',
            'from .relative import thing',
            '    import indented_within_block',
        ].join('\n');

        // Deduped, top-level only, no aliases, no relative imports.
        expect(parsePythonImports(code).sort()).to.deep.equal(
            ['flask', 'foo', 'indented_within_block', 'numpy', 'os', 'pandas', 'requests', 'sklearn'].sort(),
        );
    });

    test('extracts modules from multiple statements separated by semicolons on one line', () => {
        const code = ['import pandas; import numpy', 'x = 1; import requests; from flask import Flask'].join('\n');

        expect(parsePythonImports(code).sort()).to.deep.equal(['flask', 'numpy', 'pandas', 'requests'].sort());
    });
});

suite('listMissingPythonPackages', () => {
    function makePackage(name: string): positron.LanguageRuntimePackage {
        return { id: name, name, displayName: name, version: '0' };
    }

    function makeManager(searchResults: Record<string, string[]>): IPackageManager {
        return {
            searchPackages: sinon
                .stub()
                .callsFake((query: string) => Promise.resolve((searchResults[query] ?? []).map(makePackage))),
        } as unknown as IPackageManager;
    }

    function makeSession(missing: string[]): PackageSession {
        return {
            metadata: { sessionId: 'python-1' },
            callMethod: sinon.stub().resolves(missing),
        };
    }

    test('offers only missing imports that resolve to an installable distribution', async () => {
        const session = makeSession(['requests', 'garfblatz']);
        // requests resolves on PyPI; garfblatz does not (so it is never offered).
        const manager = makeManager({ requests: ['requests'], garfblatz: [] });

        const result = await listMissingPythonPackages(session, manager, { code: 'import requests' });

        expect(result).to.deep.equal([{ name: 'requests', referencedName: undefined }]);
    });

    test('resolves an import whose distribution name differs via the alias map', async () => {
        const session = makeSession(['cv2']);
        // There is no PyPI package named `cv2`; only the alias `opencv-python` resolves.
        const manager = makeManager({ cv2: [], 'opencv-python': ['opencv-python'] });

        const result = await listMissingPythonPackages(session, manager, { code: 'import cv2' });

        // The install name is the distribution; the import is kept for display.
        expect(result).to.deep.equal([{ name: 'opencv-python', referencedName: 'cv2' }]);
    });

    test('does not offer an aliased import when its distribution is not in the repository', async () => {
        const session = makeSession(['cv2']);
        // Neither the import name nor its alias resolves (e.g. offline / restricted index).
        const manager = makeManager({ cv2: [], 'opencv-python': [] });

        const result = await listMissingPythonPackages(session, manager, { code: 'import cv2' });

        expect(result).to.deep.equal([]);
    });

    test('passes the file directory as an import root so local modules resolve', async () => {
        const callMethod = sinon.stub().resolves([]);
        const session: PackageSession = { metadata: { sessionId: 'python-1' }, callMethod };
        const manager = makeManager({});

        // Build the URI from a real path so the expected root is derived with the
        // same (platform-specific) filesystem semantics as the code under test.
        const fileUri = vscode.Uri.file(path.join(path.resolve('project'), 'app.py'));
        const expectedRoot = path.dirname(fileUri.fsPath);

        await listMissingPythonPackages(session, manager, {
            uri: fileUri.toString(),
            code: 'from helper.helper_functions import say_hello',
        });

        // The kernel is asked about `helper` with the file's directory as a root
        // so a sibling `helper` package is recognized instead of flagged missing.
        expect(callMethod.calledOnceWith('getMissingImports', ['helper'], [expectedRoot])).to.be.true;
    });

    test('returns empty when there are no imports', async () => {
        const session = makeSession([]);
        const manager = makeManager({});

        const result = await listMissingPythonPackages(session, manager, { code: 'x = 1\n' });

        expect(result).to.deep.equal([]);
        expect((session.callMethod as sinon.SinonStub).called).to.be.false;
    });
});
