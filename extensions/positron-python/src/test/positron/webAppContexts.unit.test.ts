/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { assert } from 'chai';
import * as cmdApis from '../../client/common/vscodeApis/commandApis';
import { detectWebApp, forgetWebApp, getFramework } from '../../client/positron/webAppContexts';
import { IDisposableRegistry } from '../../client/common/types';

suite('Discover Web app frameworks', () => {
    let executeCommandStub: sinon.SinonStub;
    const disposables: IDisposableRegistry = [];
    const documents: vscode.TextDocument[] = [];

    /** Create a fake document. Detected apps are forgotten in teardown. */
    function createDocument(uri: string, text: string, scheme = 'file'): vscode.TextDocument {
        const document = ({
            getText: () => text,
            languageId: 'python',
            uri: { scheme, toString: () => uri },
        } as unknown) as vscode.TextDocument;
        documents.push(document);
        return document;
    }

    /** The value most recently set for a context key. */
    function getContext(key: string): unknown {
        const calls = executeCommandStub.getCalls().filter((call) => call.args[0] === 'setContext' && call.args[1] === key);
        return calls[calls.length - 1]?.args[2];
    }

    setup(() => {
        executeCommandStub = sinon.stub(cmdApis, 'executeCommand');
    });

    teardown(() => {
        documents.forEach(forgetWebApp);
        documents.splice(0, documents.length);
        sinon.restore();
        disposables.forEach((d) => d.dispose());
    });

    test('should set the app resource contexts if an application is found', () => {
        detectWebApp(createDocument('file:///app.py', 'from fastapi import FastAPI'));

        assert.deepStrictEqual(getContext('pythonAppResources'), ['file:///app.py']);
        assert.deepStrictEqual(getContext('pythonAppResources.fastapi'), ['file:///app.py']);
        assert.deepStrictEqual(getContext('pythonAppResources.streamlit'), []);
    });

    test('should track the framework of each open document separately', () => {
        // Regression test: a single context value for the active editor made the
        // run app actions of every other editor reflect the active editor's app.
        detectWebApp(createDocument('file:///dash_app.py', 'from dash import Dash\napp = Dash(__name__)'));
        detectWebApp(createDocument('file:///flask_app.py', 'from flask import Flask\napp = Flask(__name__)'));
        detectWebApp(createDocument('file:///script.py', 'import numpy'));

        assert.deepStrictEqual(getContext('pythonAppResources'), ['file:///dash_app.py', 'file:///flask_app.py']);
        assert.deepStrictEqual(getContext('pythonAppResources.dash'), ['file:///dash_app.py']);
        assert.deepStrictEqual(getContext('pythonAppResources.flask'), ['file:///flask_app.py']);
    });

    test('should not set contexts for a document that is not an application', () => {
        detectWebApp(createDocument('file:///script.py', 'import numpy'));

        assert.ok(executeCommandStub.notCalled);
    });

    test('should stop tracking a document that is no longer an application', () => {
        let text = 'import streamlit';
        const document = createDocument('file:///app.py', '');
        document.getText = () => text;
        detectWebApp(document);

        text = 'import numpy';
        detectWebApp(document);

        assert.deepStrictEqual(getContext('pythonAppResources'), []);
        assert.deepStrictEqual(getContext('pythonAppResources.streamlit'), []);
    });

    test('should stop tracking a closed document', () => {
        const document = createDocument('file:///app.py', 'import streamlit');
        detectWebApp(document);

        forgetWebApp(document);

        assert.deepStrictEqual(getContext('pythonAppResources'), []);
        assert.deepStrictEqual(getContext('pythonAppResources.streamlit'), []);
    });

    const frameworks = ['marimo', 'streamlit', 'gradio', 'flask', 'fastapi', 'numpy'];
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

    test('should not track notebook cell documents', () => {
        detectWebApp(createDocument('vscode-notebook-cell:/nb.ipynb#cell', 'import dash\napp = Dash(__name__)', 'vscode-notebook-cell'));

        assert.ok(executeCommandStub.notCalled);
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

        test('should detect marimo notebook', () => {
            const code = `
import marimo

__generated_with = "0.24.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    mo.md("# Hello marimo")
    return (mo,)
`;
            assert.strictEqual(getFramework(code), 'marimo');
        });

        test('should detect marimo when a cell imports another supported framework', () => {
            const code = `
import marimo

app = marimo.App()


@app.cell
def _():
    import streamlit as st
    st.write("hello")
    return
`;
            assert.strictEqual(getFramework(code), 'marimo');
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

        test('should only match app creation when import is for the same library', () => {
            const code = `
from flask import Flask

app = Dash(__name__)
`;
            assert.strictEqual(getFramework(code), 'flask');
        });

        test('should detect FastAPI app with matching import and app creation', () => {
            const code = `
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.middleware("http")                                                     
async def logging_middleware(request: Request, call_next):                  
  req_body = await request.body()  
`;
            assert.strictEqual(getFramework(code), 'fastapi');
        });
    });
});
