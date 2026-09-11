/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import { anything, when } from 'ts-mockito';
import * as vscode from 'vscode';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { createPandasDataImporter } from '../../client/positron/dataImport/pandasImporter';
import { mockedPositronNamespaces } from '../vscode-mock';

/** Runs the importer's generateCode over a file with the given name and options. */
async function generate(
    fileName: string,
    options: positron.DataImportOptions = {},
    view?: positron.DataImportView,
): Promise<positron.DataImportResult> {
    const importer = createPandasDataImporter();
    const request: positron.DataImportRequest = {
        fileUri: vscode.Uri.file(`/data/${fileName}`),
        variableName: 'flights',
        options,
        view,
    };
    return (await importer.generateCode(request)) as positron.DataImportResult;
}

suite('pandasImporter Tests', () => {
    setup(() => {
        // Stand in for the real path formatter, which quotes the path and makes it relative to
        // the workspace when it can. These files are outside any workspace, so it only quotes.
        when(mockedPositronNamespaces.paths!.formatPathForCode(anything(), anything())).thenCall((filePath: string) =>
            Promise.resolve(`"${filePath.replace(/\\/g, '/')}"`),
        );
    });

    test('registers python and the extensions the entry points offer', () => {
        const importer = createPandasDataImporter();

        expect(importer.languageId).to.equal('python');
        expect(importer.fileExtensions).to.deep.equal(['csv', 'tsv', 'xlsx', 'parquet', 'parq']);
        expect(importer.reservedNames).to.include('class');
    });

    // The registered extension list and the generator's own format detection are separate
    // pieces of code, so an extension added to one and not the other would fall silently into
    // the CSV branch. This pins every registered extension to the read function it should get.
    const readFunctions: [string, string][] = [
        ['csv', 'pd.read_csv'],
        ['tsv', 'pd.read_csv'],
        ['xlsx', 'pd.read_excel'],
        ['parquet', 'pd.read_parquet'],
        ['parq', 'pd.read_parquet'],
    ];
    readFunctions.forEach(([extension, readFunction]) => {
        test(`reads a .${extension} file with ${readFunction}`, async () => {
            expect((await generate(`flights.${extension}`)).code).to.contain(readFunction);
        });
    });

    test('embeds the literal the path formatter returns', async () => {
        when(mockedPositronNamespaces.paths!.formatPathForCode(anything(), anything())).thenReturn(
            Promise.resolve('"data/flights.csv"'),
        );

        expect((await generate('flights.csv')).code).to.contain('pd.read_csv("data/flights.csv")');
    });

    test('forwards the selected worksheet to read_excel', async () => {
        expect((await generate('flights.xlsx', { sheetName: 'Male' })).code).to.contain('sheet_name="Male"');
    });

    test('forwards a header row that is off', async () => {
        expect((await generate('flights.xlsx', { hasHeaderRow: false })).code).to.contain('header=None');
    });

    test('forwards the view so its filters and sorts are translated', async () => {
        const result = await generate(
            'flights.csv',
            {},
            {
                rowFilters: [],
                sortKeys: [{ columnName: 'delay', ascending: false }],
            },
        );

        expect(result.code).to.contain('flights.sort_values("delay", ascending=False)');
        expect(result.unsupported).to.deep.equal([]);
    });
});
