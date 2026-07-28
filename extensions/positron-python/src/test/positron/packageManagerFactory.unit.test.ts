/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import { IServiceContainer } from '../../client/ioc/types';
import { CondaPackageManager } from '../../client/positron/packages/condaPackageManager';
import { PackageManagerFactory } from '../../client/positron/packages/packageManagerFactory';
import { PipPackageManager } from '../../client/positron/packages/pipPackageManager';
import { MessageEmitter, PackageSession } from '../../client/positron/packages/types';
import { UvPackageManager } from '../../client/positron/packages/uvPackageManager';

suite('PackageManagerFactory', () => {
    // The constructors only capture their arguments, so empty stand-ins are safe here.
    const messageEmitter = { fire: () => undefined } as unknown as MessageEmitter;
    const serviceContainer = {} as unknown as IServiceContainer;
    const session = {} as unknown as PackageSession;

    function create(managerToken: string | undefined) {
        return PackageManagerFactory.create(managerToken, '/py', messageEmitter, serviceContainer, session);
    }

    // Regression: runtimeSource is now a localized display label ('Global Environments',
    // etc.), so the factory must key off the machine-readable manager token instead.
    // Selecting on the display label sent every uv/conda env to pip.
    test('selects the package manager from the manager token', () => {
        expect(create('uv')).to.be.instanceOf(UvPackageManager);
        expect(create('conda')).to.be.instanceOf(CondaPackageManager);
        expect(create('venv')).to.be.instanceOf(PipPackageManager);
        expect(create('system')).to.be.instanceOf(PipPackageManager);
        expect(create(undefined)).to.be.instanceOf(PipPackageManager);
        // A display label (what was passed before the fix) no longer matches uv/conda.
        expect(create('Global Environments')).to.be.instanceOf(PipPackageManager);
    });
});
