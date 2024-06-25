/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from 'typemoq';
import * as tsMockito from 'ts-mockito';

// Initialize Positron for Python extension integration tests.
export function initializePositron(): void {
    // Use a late import since this module may be imported without Positron being installed
    // e.g. in unit tests.
    // eslint-disable-next-line global-require
    const vscode = require('vscode') as typeof import('vscode');

    // Don't start Positron interpreters automatically during tests.
    vscode.workspace
        .getConfiguration('positron.interpreters')
        .update('automaticStartup', false, vscode.ConfigurationTarget.Global);
}

// Save a reference to the original patched objects.
const originalTypeMoqMockOfType = TypeMoq.Mock.ofType;
const originalTsMockitoMock = tsMockito.mock;

/**
 * InversifyJS v6 (required by TypeScript v5) tries to await bound objects if they
 * look like promises. TypeMoq's dynamic mocks and ts-mockito instances unfortunately
 * do look like promises by default (they are functions and their properties are functions,
 * including `then`). This causes unexpected behavior in InversifyJS.
 *
 * Here, we patch `TypeMoq.Mock.ofType` and `tsMockito.mock` to setup the `then` property to return
 * undefined to avoid the above behavior.
 */
export function patchMockingLibs(): void {
    // Patch TypeMoq.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TypeMoq.Mock.ofType = function <U>(targetConstructor?: any, behavior?: any, ...args: never[]): TypeMoq.IMock<U> {
        const mock = originalTypeMoqMockOfType(targetConstructor, behavior, ...args);

        // Only setup `then` if the target constructor is undefined, meaning the mock is dynamic
        if (targetConstructor === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const returnsResult = mock.setup((x: any) => x.then).returns(() => undefined);

            // If a user configures 'strict' mock behavior, all setups are expected to be called
            // once. Override this by allowing `then` to be called any number of times.
            if (behavior === TypeMoq.MockBehavior.Strict) {
                returnsResult.verifiable(TypeMoq.Times.atLeast(0));
            }
        }

        return mock as TypeMoq.IMock<U>;
    };

    // Patch ts-mockito.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tsMockito as any).mock = function <T>(...args: never[]): T {
        const mocked = originalTsMockitoMock(...args);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tsMockito.when((mocked as any).then).thenReturn(undefined);
        return mocked as T;
    };
}
