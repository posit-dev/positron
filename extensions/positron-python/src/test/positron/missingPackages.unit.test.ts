/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as positron from 'positron';
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
});

suite('listMissingPythonPackages', () => {
    function makePackage(name: string): positron.LanguageRuntimePackage {
        return { id: name, name, displayName: name, version: '0' };
    }

    function makeManager(searchResults: Record<string, string[]>): IPackageManager {
        return {
            searchPackages: sinon.stub().callsFake((query: string) =>
                Promise.resolve((searchResults[query] ?? []).map(makePackage)),
            ),
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

    test('returns empty when there are no imports', async () => {
        const session = makeSession([]);
        const manager = makeManager({});

        const result = await listMissingPythonPackages(session, manager, { code: 'x = 1\n' });

        expect(result).to.deep.equal([]);
        expect((session.callMethod as sinon.SinonStub).called).to.be.false;
    });
});
