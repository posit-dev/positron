/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import {
    classifyPackages,
    environmentPackageNames,
    KernelPackageEntry,
} from '../../client/positron/packages/bundledPackages';

const BUNDLE = path.resolve('/ext/python_files/lib/ipykernel/arm64/cp3');
const BUNDLE_PATHS = [BUNDLE, path.resolve('/ext/python_files/lib/ipykernel/py3')];
const SITE = path.resolve('/env/lib/python3.12/site-packages');

function entry(name: string, version: string, extra: Partial<KernelPackageEntry> = {}): KernelPackageEntry {
    return { id: `${name}-${version}`, name, displayName: name, version, ...extra };
}

suite('bundledPackages Tests', () => {
    test('env-only package is not bundled', () => {
        const [pkg] = classifyPackages([entry('pandas', '2.2.0', { location: SITE })], BUNDLE_PATHS);
        expect(pkg).to.deep.equal({ id: 'pandas-2.2.0', name: 'pandas', displayName: 'pandas', version: '2.2.0' });
    });

    test('bundled-only package is bundled with no environment version', () => {
        const [pkg] = classifyPackages([entry('tornado', '6.5.7', { location: BUNDLE })], BUNDLE_PATHS);
        expect(pkg).to.deep.equal({
            id: 'tornado-6.5.7',
            name: 'tornado',
            displayName: 'tornado',
            version: '6.5.7',
            bundled: true,
        });
    });

    test('bundled package also in the env reports the env copy', () => {
        const [pkg] = classifyPackages(
            [
                entry('tornado', '6.5.7', {
                    location: BUNDLE,
                    shadowed: [
                        { version: '6.5.6', location: path.join(BUNDLE_PATHS[1]) },
                        { version: '6.4.0', location: SITE },
                    ],
                }),
            ],
            BUNDLE_PATHS,
        );
        expect(pkg.bundled).to.equal(true);
        expect(pkg.environmentVersion).to.equal('6.4.0');
        expect(pkg).to.not.have.property('shadowed');
        expect(pkg).to.not.have.property('location');
    });

    test('a location under a bundle path counts as bundled', () => {
        const [pkg] = classifyPackages(
            [entry('tornado', '6.5.7', { location: path.join(BUNDLE, 'nested') })],
            BUNDLE_PATHS,
        );
        expect(pkg.bundled).to.equal(true);
    });

    test('a sibling path that shares a prefix is not bundled', () => {
        const [pkg] = classifyPackages([entry('tornado', '6.5.7', { location: `${BUNDLE}x` })], BUNDLE_PATHS);
        expect(pkg.bundled).to.equal(undefined);
    });

    test('without bundle paths nothing is bundled', () => {
        const [pkg] = classifyPackages([entry('tornado', '6.5.7', { location: BUNDLE })], undefined);
        expect(pkg).to.deep.equal({ id: 'tornado-6.5.7', name: 'tornado', displayName: 'tornado', version: '6.5.7' });
    });

    test('an entry without a location is not bundled', () => {
        const [pkg] = classifyPackages([entry('oddball', '1.0')], BUNDLE_PATHS);
        expect(pkg.bundled).to.equal(undefined);
    });

    test('Windows paths that differ only in drive-letter case match on win32', () => {
        const [pkg] = classifyPackages(
            [entry('tornado', '6.5.7', { location: 'c:\\ext\\lib\\ipykernel\\x64\\cp3' })],
            ['C:\\ext\\lib\\ipykernel\\x64\\cp3'],
            'win32',
        );
        expect(pkg.bundled).to.equal(true);
    });

    test('drive-letter case is not folded off Windows', () => {
        const [pkg] = classifyPackages([entry('tornado', '6.5.7', { location: '/Ext/cp3' })], ['/ext/cp3'], 'linux');
        expect(pkg.bundled).to.equal(undefined);
    });

    test('environmentPackageNames leaves out bundled-only packages', () => {
        const names = environmentPackageNames([
            { id: 'pandas', name: 'pandas', displayName: 'pandas', version: '2.2.0' },
            { id: 'tornado', name: 'tornado', displayName: 'tornado', version: '6.5.7', bundled: true },
            {
                id: 'six',
                name: 'six',
                displayName: 'six',
                version: '1.17.0',
                bundled: true,
                environmentVersion: '1.16.0',
            },
        ]);
        expect(names).to.deep.equal(['pandas', 'six']);
    });
});
