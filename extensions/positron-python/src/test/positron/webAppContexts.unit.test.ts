import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { assert } from 'chai';
import * as cmdApis from '../../client/common/vscodeApis/commandApis';
import { detectWebApp, getAppFramework } from '../../client/positron/webAppContexts';
import { IDisposableRegistry } from '../../client/common/types';

suite('Discover webapp frameworks', () => {
    let document: vscode.TextDocument;
    let executeCommandStub: sinon.SinonStub;
    const disposables: IDisposableRegistry = [];

    setup(() => {
        executeCommandStub = sinon.stub(cmdApis, 'executeCommand');
        document = {
            getText: () => '',
        } as vscode.TextDocument;
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach((d) => d.dispose());
    });

    const texts = ['import streamlit', 'from shiny.ui import page_navbar', 'import numpy'];
    texts.forEach((text) => {
        const expected = !text.includes('numpy');
        test('should set context pythonFileContainsApp if application is found', () => {
            document.getText = () => text;
            detectWebApp(document);

            assert.ok(executeCommandStub.calledOnceWith('setContext', 'pythonFileContainsApp', expected));
        });
    });

    const frameworks = ['streamlit', 'shiny', 'gradio', 'flask', 'fastapi', 'numpy'];
    frameworks.forEach((framework) => {
        const expected = framework === 'numpy' ? undefined : framework;
        test(`should detect ${expected}: import framework`, () => {
            const text = `import ${framework}`;
            const actual = getAppFramework(text);

            assert.strictEqual(actual, expected);
        });
        test(`should detect ${expected}: from framework.test import XYZ`, () => {
            const text = `from ${framework}.test import XYZ`;
            const actual = getAppFramework(text);

            assert.strictEqual(actual, expected);
        });
        test(`should detect ${expected}: from framework import XYZ`, () => {
            const text = `from ${framework} import XYZ`;
            const actual = getAppFramework(text);

            assert.strictEqual(actual, expected);
        });
    });
});
