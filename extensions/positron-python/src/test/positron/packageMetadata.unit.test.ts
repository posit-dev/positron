/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { fetchMetadataWithOutdated } from '../../client/positron/packages/packageMetadata';

suite('packageMetadata - fetchMetadataWithOutdated', () => {
    const PACKAGES: positron.PackageSpec[] = [
        { name: 'NumPy', version: '1.26.0' },
        { name: 'pandas', version: '2.0.0' },
        { name: 'requests', version: '2.31.0' },
    ];

    const ADVISORY: positron.PackageVulnerability = {
        id: 'CVE-2018-6594',
        osvId: 'GHSA-6528-wvf6-f6qg',
        score: 8.7,
        scoreVersion: 'v4',
    };

    test('merges outdated versions and vulnerabilities, keyed by lowercase name', async () => {
        const metadata = await fetchMetadataWithOutdated(
            PACKAGES,
            () => Promise.resolve(new Map([['numpy', '2.1.0']])),
            () =>
                Promise.resolve(
                    new Map([
                        ['numpy', [ADVISORY]], // vulnerable
                        ['pandas', []], // known to the repo, no advisories
                        // requests absent: unknown to the repo at that version
                    ]),
                ),
        );

        expect(metadata.get('numpy')).to.deep.equal({
            outdated: true,
            latestVersion: '2.1.0',
            vulnerabilities: [ADVISORY],
        });
        // An empty advisory list passes through: affirmative "no known
        // vulnerabilities", distinct from no data.
        expect(metadata.get('pandas')).to.deep.equal({ outdated: false, vulnerabilities: [] });
        // Absent from the vulnerability map = unknown: no `vulnerabilities`
        // key at all, rather than a claim of cleanliness.
        expect(metadata.get('requests')).to.deep.equal({ outdated: false });
    });

    test('leaves vulnerabilities undefined when no getVulnerabilities callback is supplied', async () => {
        const metadata = await fetchMetadataWithOutdated(PACKAGES, () =>
            Promise.resolve(new Map([['numpy', '2.1.0']])),
        );

        expect(metadata.get('numpy')).to.deep.equal({ outdated: true, latestVersion: '2.1.0' });
        expect(metadata.get('pandas')).to.deep.equal({ outdated: false });
    });

    test('treats a failed outdated lookup as nothing outdated, keeping vulnerability data', async () => {
        const metadata = await fetchMetadataWithOutdated(
            PACKAGES,
            () => Promise.reject(new Error('resolver offline')),
            () => Promise.resolve(new Map([['numpy', [ADVISORY]]])),
        );

        expect(metadata.get('numpy')).to.deep.equal({ outdated: false, vulnerabilities: [ADVISORY] });
        expect(metadata.get('requests')).to.deep.equal({ outdated: false });
    });

    test('leaves vulnerabilities undefined for every package when the lookup resolves undefined', async () => {
        const metadata = await fetchMetadataWithOutdated(
            PACKAGES,
            () => Promise.resolve(new Map()),
            () => Promise.resolve(undefined),
        );

        expect(metadata.get('numpy')).to.deep.equal({ outdated: false });
    });
});
