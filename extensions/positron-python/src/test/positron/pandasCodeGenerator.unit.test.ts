/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import { escapePythonString, generatePandasImportCode } from '../../client/positron/dataImport/pandasCodeGenerator';

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

    suite('generatePandasImportCode', () => {
        test('generates a read_csv call with the import and a labelled comment', () => {
            const code = generatePandasImportCode({
                pathLiteral: '"data/flights.csv"',
                variableName: 'flights',
                hasHeaderRow: true,
            });

            expect(code.code).to.equal(
                'import pandas as pd\n' +
                    '\n' +
                    '# Load flights data\n' +
                    'flights = pd.read_csv("data/flights.csv")\n',
            );
        });

        test('treats a missing hasHeaderRow as a header row', () => {
            const code = generatePandasImportCode({
                pathLiteral: '"data/flights.csv"',
                variableName: 'flights',
            });

            expect(code.code).to.contain('pd.read_csv("data/flights.csv")');
        });

        test('adds header=None when the header row is off', () => {
            const code = generatePandasImportCode({
                pathLiteral: '"data/flights.csv"',
                variableName: 'flights',
                hasHeaderRow: false,
            });

            expect(code.code).to.contain('flights = pd.read_csv("data/flights.csv", header=None)');
        });

        test('adds a tab separator for a tsv file', () => {
            const code = generatePandasImportCode({
                pathLiteral: '"data/flights.tsv"',
                variableName: 'flights',
                hasHeaderRow: true,
            });

            expect(code.code).to.contain('flights = pd.read_csv("data/flights.tsv", sep="\\t")');
        });

        test('orders the separator before the header argument', () => {
            const code = generatePandasImportCode({
                pathLiteral: '"data/flights.TSV"',
                variableName: 'flights',
                hasHeaderRow: false,
            });

            expect(code.code).to.contain('flights = pd.read_csv("data/flights.TSV", sep="\\t", header=None)');
        });

        test('embeds the pre-formatted path literal verbatim, without re-escaping it', () => {
            // The literal comes from positron.paths.formatPathForCode, already quoted and escaped.
            const code = generatePandasImportCode({
                pathLiteral: '"C:/Users/austin/data/a\\"b.csv"',
                variableName: 'flights',
                hasHeaderRow: true,
            });

            expect(code.code).to.contain('pd.read_csv("C:/Users/austin/data/a\\"b.csv")');
        });
    });

    suite('view translation', () => {
        const base = {
            pathLiteral: '"data/flights.csv"',
            variableName: 'flights',
            hasHeaderRow: true,
        };
        const emptyView = { rowFilters: [], sortKeys: [] };

        test('translates a compare filter and a descending sort', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'carrier',
                            columnType: 'string',
                            condition: 'and' as const,
                            filterType: 'compare' as const,
                            op: '=' as const,
                            value: 'UA',
                        },
                    ],
                    sortKeys: [{ columnName: 'dep_delay', ascending: false }],
                },
            });

            expect(result.unsupported).to.deep.equal([]);
            expect(result.code).to.equal(
                'import pandas as pd\n' +
                    '\n' +
                    '# Load flights data\n' +
                    'flights = pd.read_csv("data/flights.csv")\n' +
                    '\n' +
                    '# Filter and sort as shown in the Data Explorer\n' +
                    'flights = flights[(flights["carrier"] == "UA")]\n' +
                    'flights = flights.sort_values("dep_delay", ascending=False)\n',
            );
        });

        test("joins filters with & and | per each filter's condition", () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'dep_delay',
                            columnType: 'integer',
                            condition: 'and' as const,
                            filterType: 'compare' as const,
                            op: '>' as const,
                            value: '30',
                        },
                        {
                            columnName: 'carrier',
                            columnType: 'string',
                            condition: 'or' as const,
                            filterType: 'set_membership' as const,
                            values: ['UA', 'AA'],
                            inclusive: true,
                        },
                    ],
                },
            });

            expect(result.code).to.include(
                'flights = flights[(flights["dep_delay"] > 30) | flights["carrier"].isin(["UA", "AA"])]',
            );
        });

        test('translates the remaining filter types', () => {
            const view = {
                ...emptyView,
                rowFilters: [
                    {
                        columnName: 'n',
                        columnType: 'integer',
                        condition: 'and' as const,
                        filterType: 'not_between' as const,
                        leftValue: '1',
                        rightValue: '9',
                    },
                    {
                        columnName: 'name',
                        columnType: 'string',
                        condition: 'and' as const,
                        filterType: 'search' as const,
                        searchType: 'starts_with' as const,
                        term: 'Mc',
                        caseSensitive: false,
                    },
                    {
                        columnName: 'ok',
                        columnType: 'boolean',
                        condition: 'and' as const,
                        filterType: 'is_true' as const,
                    },
                    {
                        columnName: 'note',
                        columnType: 'string',
                        condition: 'and' as const,
                        filterType: 'is_null' as const,
                    },
                ],
            };

            const result = generatePandasImportCode({ ...base, view });

            expect(result.unsupported).to.deep.equal([]);
            expect(result.code).to.include(
                'flights = flights[(~flights["n"].between(1, 9) & flights["n"].notna())' +
                    ' & flights["name"].str.lower().str.startswith("mc", na=False)' +
                    ' & flights["ok"].eq(True).fillna(False)' +
                    ' & flights["note"].isna()]',
            );
        });

        test('excludes nulls from negated filters, as the backend does', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'note',
                            columnType: 'string',
                            condition: 'and' as const,
                            filterType: 'search' as const,
                            searchType: 'not_contains' as const,
                            term: 'delay',
                            caseSensitive: true,
                        },
                        {
                            columnName: 'carrier',
                            columnType: 'string',
                            condition: 'and' as const,
                            filterType: 'set_membership' as const,
                            values: ['UA'],
                            inclusive: false,
                        },
                        {
                            columnName: 'name',
                            columnType: 'string',
                            condition: 'and' as const,
                            filterType: 'not_empty' as const,
                        },
                        {
                            columnName: 'dep_delay',
                            columnType: 'integer',
                            condition: 'and' as const,
                            filterType: 'compare' as const,
                            op: '!=' as const,
                            value: '30',
                        },
                    ],
                },
            });

            expect(result.unsupported).to.deep.equal([]);
            expect(result.code).to.include(
                'flights = flights[~flights["note"].str.contains("delay", case=True, regex=False, na=True)' +
                    ' & (~flights["carrier"].isin(["UA"]) & flights["carrier"].notna())' +
                    ' & (flights["name"].notna() & (flights["name"] != ""))' +
                    ' & (flights["dep_delay"].notna() & (flights["dep_delay"] != 30))]',
            );
        });

        test('leaves the other comparison operators alone, being false for a null already', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'dep_delay',
                            columnType: 'integer',
                            condition: 'and' as const,
                            filterType: 'compare' as const,
                            op: '>' as const,
                            value: '30',
                        },
                    ],
                },
            });

            expect(result.code).to.include('flights = flights[(flights["dep_delay"] > 30)]');
        });

        test('sorts on multiple keys with an ascending list', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    sortKeys: [
                        { columnName: 'year', ascending: true },
                        { columnName: 'dep_delay', ascending: false },
                    ],
                },
            });

            expect(result.code).to.include(
                'flights = flights.sort_values(["year", "dep_delay"], ascending=[True, False])',
            );
        });

        test('masks a false boolean without inverting the column, which nulls would break', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'ok',
                            columnType: 'boolean',
                            condition: 'and' as const,
                            filterType: 'is_false' as const,
                        },
                    ],
                },
            });

            expect(result.code).to.include('flights = flights[flights["ok"].eq(False).fillna(False)]');
        });

        test('drops leading zeros, which Python rejects on an integer literal', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'n',
                            columnType: 'integer',
                            condition: 'and' as const,
                            filterType: 'between' as const,
                            leftValue: '01',
                            rightValue: '-007',
                        },
                        {
                            columnName: 'rate',
                            columnType: 'floating',
                            condition: 'and' as const,
                            filterType: 'set_membership' as const,
                            values: ['0.5', '000', '01.5'],
                            inclusive: true,
                        },
                    ],
                },
            });

            expect(result.unsupported).to.deep.equal([]);
            expect(result.code).to.include(
                'flights = flights[flights["n"].between(1, -7)' + ' & flights["rate"].isin([0.5, 0, 1.5])]',
            );
        });

        test('translates a regex search', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'name',
                            columnType: 'string',
                            condition: 'and' as const,
                            filterType: 'search' as const,
                            searchType: 'regex_match' as const,
                            term: '^Mc[a-z]+$',
                            caseSensitive: true,
                        },
                    ],
                },
            });

            expect(result.unsupported).to.deep.equal([]);
            expect(result.code).to.include(
                'flights["name"].str.contains("^Mc[a-z]+$", case=True, regex=True, na=False)',
            );
        });

        test('reports a filter whose value is not a literal of the column type', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'dep_delay',
                            columnType: 'integer',
                            condition: 'and' as const,
                            filterType: 'compare' as const,
                            op: '>' as const,
                            value: 'thirty',
                        },
                    ],
                },
            });

            expect(result.unsupported).to.deep.equal(['filter on "dep_delay" (compare)']);
            expect(result.code).to.not.include('thirty');
        });

        test('reports a compare filter on a non-string, non-numeric, non-boolean column type as unsupported', () => {
            const result = generatePandasImportCode({
                ...base,
                view: {
                    ...emptyView,
                    rowFilters: [
                        {
                            columnName: 'flight_date',
                            columnType: 'date',
                            condition: 'and' as const,
                            filterType: 'compare' as const,
                            op: '>' as const,
                            value: '2024-01-01',
                        },
                    ],
                },
            });

            expect(result.unsupported).to.deep.equal(['filter on "flight_date" (compare)']);
            expect(result.code).to.not.include('2024-01-01');
        });

        test('reports the whole view as unsupported when the file has no header row', () => {
            const result = generatePandasImportCode({
                ...base,
                hasHeaderRow: false,
                view: {
                    ...emptyView,
                    sortKeys: [{ columnName: 'column0', ascending: true }],
                },
            });

            expect(result.unsupported).to.have.lengthOf(1);
            expect(result.unsupported[0]).to.include('header');
            expect(result.code).to.include('header=None');
            expect(result.code).to.not.include('sort_values');
        });
    });
});
