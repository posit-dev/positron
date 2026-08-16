/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as sinon from 'sinon';
import { IFileSystem } from '../../client/common/platform/types';
import {
    addInstalledToRequirements,
    removeUninstalledFromRequirements,
} from '../../client/positron/packages/requirementsSync';

function fakeFs(initial: string): { fs: IFileSystem; writeFile: sinon.SinonStub; written: () => string } {
    let content = initial;
    const writeFile = sinon.stub().callsFake((_p: string, text: string) => {
        content = text;
        return Promise.resolve();
    });
    const fs = {
        readFile: sinon.stub().callsFake(() => Promise.resolve(content)),
        writeFile,
    } as unknown as IFileSystem;
    return { fs, writeFile, written: () => content };
}

suite('requirementsSync', () => {
    test('appends only requested packages that are confirmed installed', async () => {
        const { fs, written } = fakeFs('flask==2.2.0\n');
        await addInstalledToRequirements(fs, '/w/requirements.txt', ['pandas', 'ghost'], ['flask', 'pandas']);
        expect(written()).to.equal('flask==2.2.0\npandas\n');
    });

    test('does not write when the requested package is not confirmed installed', async () => {
        const { fs, writeFile } = fakeFs('flask==2.2.0\n');
        await addInstalledToRequirements(fs, '/w/requirements.txt', ['pandas'], ['flask']);
        expect(writeFile.called).to.equal(false);
    });

    test('removes only requested packages that are confirmed absent', async () => {
        const { fs, written } = fakeFs('flask==2.2.0\nrequests\n');
        await removeUninstalledFromRequirements(fs, '/w/requirements.txt', ['requests'], ['flask']);
        expect(written()).to.equal('flask==2.2.0\n');
    });

    test('swallows read/write failure without throwing', async () => {
        const fs = {
            readFile: sinon.stub().rejects(new Error('EACCES')),
            writeFile: sinon.stub(),
        } as unknown as IFileSystem;
        // Must not throw.
        await addInstalledToRequirements(fs, '/w/requirements.txt', ['pandas'], ['pandas']);
    });
});
