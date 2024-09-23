/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { assert } from 'chai';
import * as cmdApis from '../../client/common/vscodeApis/commandApis';
import { detectWebApp, getFramework } from '../../client/positron/webAppContexts';
import { IDisposableRegistry } from '../../client/common/types';

suite('Discover Web app frameworks', () => {
    let document: vscode.TextDocument;
    let executeCommandStub: sinon.SinonStub;
    let getExtensionStub: sinon.SinonStub;
    const disposables: IDisposableRegistry = [];

    setup(() => {
        executeCommandStub = sinon.stub(cmdApis, 'executeCommand');
        document = {
            getText: () => '',
        } as vscode.TextDocument;
        getExtensionStub = sinon.stub(vscode.extensions, 'getExtension');
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach((d) => d.dispose());
    });

    const texts = {
        'import streamlit': 'streamlit',
        'from shiny.ui import page_navbar': 'shiny',
        'import numpy': 'numpy',
    };
    Object.entries(texts).forEach(([text, framework]) => {
        const expected = text.includes('numpy') ? undefined : framework;
        test('should set context pythonAppFramework if application is found', () => {
            getExtensionStub.withArgs('Posit.shiny').returns({ isActive: false });
            document.getText = () => text;
            detectWebApp(document);

            assert.ok(executeCommandStub.calledOnceWith('setContext', 'pythonAppFramework', expected));
        });
    });

    const frameworks = ['streamlit', 'shiny', 'gradio', 'flask', 'fastapi', 'numpy'];
    frameworks.forEach((framework) => {
        const expected = framework === 'numpy' ? undefined : framework;
        test(`should detect ${expected}: import framework`, () => {
            const text = `import ${framework}`;
            const actual = getFramework(text);

            assert.strictEqual(actual, expected);
        });
        test(`should detect ${expected}: from framework.test import XYZ`, () => {
            const text = `from ${framework}.test import XYZ`;
            const actual = getFramework(text);

            assert.strictEqual(actual, expected);
        });
        test(`should detect ${expected}: from framework import XYZ`, () => {
            const text = `from ${framework} import XYZ`;
            const actual = getFramework(text);

            assert.strictEqual(actual, expected);
        });
    });
    test(`should not detect shiny if extension is installed`, () => {
        getExtensionStub.withArgs('Posit.shiny').returns({ isActive: true });
        const text = `from shiny import XYZ`;
        const actual = getFramework(text);

        assert.strictEqual(actual, undefined);
    });
});
