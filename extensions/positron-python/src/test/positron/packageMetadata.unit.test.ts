/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { fetchMetadataWithOutdated } from '../../client/positron/packages/packageMetadata';

suite('packageMetadata - fetchMetadataWithOutdated', () => {
    const PACKAGE_NAMES = ['NumPy', 'pandas', 'requests'];

    test('merges outdated versions, keyed by lowercase name', async () => {
        const metadata = await fetchMetadataWithOutdated(PACKAGE_NAMES, () =>
            Promise.resolve(new Map([['numpy', '2.1.0']])),
        );

        expect(metadata.get('numpy')).to.deep.equal({ outdated: true, latestVersion: '2.1.0' });
        // Absent from the resolver's outdated map: current, and no latest
        // version to report.
        expect(metadata.get('pandas')).to.deep.equal({ outdated: false });
        expect(metadata.get('requests')).to.deep.equal({ outdated: false });
    });

    test('treats a failed outdated lookup as nothing outdated', async () => {
        const metadata = await fetchMetadataWithOutdated(PACKAGE_NAMES, () =>
            Promise.reject(new Error('resolver offline')),
        );

        expect(metadata.get('numpy')).to.deep.equal({ outdated: false });
        expect(metadata.get('requests')).to.deep.equal({ outdated: false });
    });
});
