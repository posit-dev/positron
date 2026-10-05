/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import { anything, when } from 'ts-mockito';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { createJsonDataImporter } from '../../client/positron/dataImport/jsonImporter';
import { mockedPositronNamespaces } from '../vscode-mock';

suite('jsonImporter Tests', () => {
    setup(() => {
        // Stand in for the real path formatter, which only quotes paths outside a workspace.
        when(mockedPositronNamespaces.paths!.formatPathForCode(anything(), anything())).thenCall((filePath: string) =>
            Promise.resolve(`"${filePath.replace(/\\/g, '/')}"`),
        );
    });

    test('registers python for .json files', () => {
        const importer = createJsonDataImporter();

        expect([importer.languageId, importer.displayName, importer.fileExtensions]).to.deep.equal([
            'python',
            'Python (json)',
            ['json'],
        ]);
    });

    test('loads the file with json.load', async () => {
        const result = (await createJsonDataImporter().generateCode({
            fileUri: vscode.Uri.file('/data/config.json'),
            variableName: 'config',
            options: {},
        })) as positron.DataImportResult;

        expect(result.code).to.equal(
            [
                'import json',
                '',
                '# Load config data',
                'with open("/data/config.json") as f:',
                '    config = json.load(f)',
                '',
            ].join('\n'),
        );
    });
});
