/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import {
    deriveVariableName,
    escapePythonString,
    generatePandasImportCode,
} from '../../client/positron/dataImport/pandasCodeGenerator';

suite('pandasCodeGenerator Tests', () => {
    suite('escapePythonString', () => {
        test('escapes backslashes and double quotes', () => {
            expect(escapePythonString('C:\\data\\flights.csv')).to.equal('C:\\\\data\\\\flights.csv');
            expect(escapePythonString('/data/say "hi".csv')).to.equal('/data/say \\"hi\\".csv');
        });

        test('leaves an ordinary posix path untouched', () => {
            expect(escapePythonString('/Users/austin/data/flights.csv')).to.equal('/Users/austin/data/flights.csv');
        });

        test('escapes the control characters a posix file name may legally contain', () => {
            expect(escapePythonString('/data/two\nlines.csv')).to.equal('/data/two\\nlines.csv');
            expect(escapePythonString('/data/carriage\rreturn.csv')).to.equal('/data/carriage\\rreturn.csv');
            expect(escapePythonString('/data/tab\tbed.csv')).to.equal('/data/tab\\tbed.csv');
            expect(escapePythonString('/data/bell\u0007.csv')).to.equal('/data/bell\\x07.csv');
            expect(escapePythonString('/data/delete\u007f.csv')).to.equal('/data/delete\\x7f.csv');
        });
    });

    suite('deriveVariableName', () => {
        test('strips the extension', () => {
            expect(deriveVariableName('flights.csv')).to.equal('flights');
        });

        test('replaces characters that are invalid in an identifier', () => {
            expect(deriveVariableName('my data-2020.tsv')).to.equal('my_data_2020');
        });

        test('prefixes a leading digit, which cannot start a Python identifier', () => {
            expect(deriveVariableName('2020 data.csv')).to.equal('_2020_data');
        });

        test('suffixes a Python keyword, which cannot be assigned to', () => {
            expect(deriveVariableName('class.csv')).to.equal('class_');
            expect(deriveVariableName('import.tsv')).to.equal('import_');
        });

        test('leaves a soft keyword alone, because it is a valid identifier', () => {
            expect(deriveVariableName('match.csv')).to.equal('match');
        });

        test('falls back to a usable name when nothing survives sanitization', () => {
            expect(deriveVariableName('.csv')).to.equal('data');
            expect(deriveVariableName('---.csv')).to.equal('data');
        });
    });

    suite('generatePandasImportCode', () => {
        test('generates a read_csv call with the import and a labelled comment', () => {
            const code = generatePandasImportCode({
                filePath: '/Users/austin/data/flights.csv',
                variableName: 'flights',
                hasHeaderRow: true,
            });

            expect(code).to.equal(
                'import pandas as pd\n' +
                    '\n' +
                    '# Load flights data\n' +
                    'flights = pd.read_csv("/Users/austin/data/flights.csv")\n',
            );
        });

        test('treats a missing hasHeaderRow as a header row', () => {
            const code = generatePandasImportCode({
                filePath: '/data/flights.csv',
                variableName: 'flights',
            });

            expect(code).to.contain('pd.read_csv("/data/flights.csv")');
        });

        test('adds header=None when the header row is off', () => {
            const code = generatePandasImportCode({
                filePath: '/data/flights.csv',
                variableName: 'flights',
                hasHeaderRow: false,
            });

            expect(code).to.contain('flights = pd.read_csv("/data/flights.csv", header=None)');
        });

        test('adds a tab separator for a tsv file', () => {
            const code = generatePandasImportCode({
                filePath: '/data/flights.tsv',
                variableName: 'flights',
                hasHeaderRow: true,
            });

            expect(code).to.contain('flights = pd.read_csv("/data/flights.tsv", sep="\\t")');
        });

        test('orders the separator before the header argument', () => {
            const code = generatePandasImportCode({
                filePath: '/data/flights.TSV',
                variableName: 'flights',
                hasHeaderRow: false,
            });

            expect(code).to.contain('flights = pd.read_csv("/data/flights.TSV", sep="\\t", header=None)');
        });

        test('escapes a windows path in the generated literal', () => {
            const code = generatePandasImportCode({
                filePath: 'C:\\Users\\austin\\data\\flights.csv',
                variableName: 'flights',
                hasHeaderRow: true,
            });

            expect(code).to.contain('pd.read_csv("C:\\\\Users\\\\austin\\\\data\\\\flights.csv")');
        });
    });
});
