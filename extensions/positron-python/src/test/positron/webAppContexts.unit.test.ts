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
    const disposables: IDisposableRegistry = [];

    setup(() => {
        executeCommandStub = sinon.stub(cmdApis, 'executeCommand');
        document = {
            getText: () => '',
            languageId: 'python',
        } as vscode.TextDocument;
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach((d) => d.dispose());
    });

    const texts = {
        'import streamlit': 'streamlit',
        'from fastapi import FastAPI': 'fastapi',
        'import numpy': 'numpy',
    };
    Object.entries(texts).forEach(([text, framework]) => {
        const expected = text.includes('numpy') ? undefined : framework;
        test('should set context pythonAppFramework if application is found', () => {
            document.getText = () => text;
            detectWebApp(document);

            assert.ok(executeCommandStub.calledOnceWith('setContext', 'pythonAppFramework', expected));
        });
    });

    const frameworks = ['streamlit', 'gradio', 'flask', 'fastapi', 'numpy'];
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

    // Tests for app creation patterns
    suite('App Creation Pattern Detection', () => {
        test('should detect Dash app when Flask is also imported', () => {
            const code = `
import flask
import plotly.express as px
from dash import Dash, Input, Output, callback, dcc, html

app = Dash()
`;
            assert.strictEqual(getFramework(code), 'dash');
        });

        test('should detect Dash app with custom variable name', () => {
            const code = `
import flask
from dash import Dash

my_dashboard = Dash(__name__)
`;
            assert.strictEqual(getFramework(code), 'dash');
        });

        test('should detect Flask app with custom variable name', () => {
            const code = `
from flask import Flask

web_service = Flask(__name__)

@web_service.route('/')
def hello_world():
    return 'Hello, World!'
`;
            assert.strictEqual(getFramework(code), 'flask');
        });

        test('should detect FastAPI app with custom variable name', () => {
            const code = `
from fastapi import FastAPI

api_service = FastAPI()

@api_service.get("/")
def read_root():
    return {"Hello": "World"}
`;
            assert.strictEqual(getFramework(code), 'fastapi');
        });

        test('should detect Gradio app with custom variable name', () => {
            const code = `
import gradio as gr

def greet(name):
    return "Hello " + name + "!"

interface = gr.Interface(fn=greet, inputs="text", outputs="text")
`;
            assert.strictEqual(getFramework(code), 'gradio');
        });

        test('should prioritize app creation over imports', () => {
            const code = `
import streamlit
import flask
import dash

app = Dash(__name__)
`;
            assert.strictEqual(getFramework(code), 'dash');
        });
    });
});
