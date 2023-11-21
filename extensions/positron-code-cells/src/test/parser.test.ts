/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { Cell, CellDecorationSetting, CellType, getParser, parseCells } from '../parser';

suite(
	'Parser',
	() => {
		async function createDocument(language: string, content: string): Promise<vscode.TextDocument> {
			return vscode.workspace.openTextDocument({ language, content });
		}

		async function createDocumentAndSingleCell(language: string, content: string, cellType: CellType): Promise<[vscode.TextDocument, Cell]> {
			const document = await createDocument(language, content);
			const lastLine = document.lineAt(document.lineCount - 1);
			const cell: Cell = {
				range: new vscode.Range(zeroPosition, lastLine.range.end),
				type: cellType,
			};
			return [document, cell];
		}

		async function assertParsesCells(language: string, content: string, expected: Cell[]): Promise<void> {
			const document = await createDocument(language, content);
			assert.deepStrictEqual(parseCells(document), expected);
		}

		const zeroPosition = new vscode.Position(0, 0);

		const noCellsTests: [string, string, string][] = [
			['Empty Python document should have no cells', 'python', ''],
			['Empty R document should have no cells', 'r', ''],
			['Document with an unsupported language should have no cells', 'unknown-language', '# %%\n123']
		];
		noCellsTests.forEach(([title, language, content]) => {
			test(
				title,
				async () => {
					assertParsesCells(language, content, []);
				}
			);
		});

		suite(
			'Python Parser',
			() => {
				const language = 'python';
				const codeCellBody = '123\n456';
				const codeCell = `# %%\n${codeCellBody}`;
				const markdownBody = `# H1
## H2

And a [link](target)`;
				const commentedMarkdownBody = markdownBody.split('\n').map(line => `# ${line}`).join('\n');
				const commentedMarkdownCell = `# %% [markdown]\n${commentedMarkdownBody}`;
				const singleQuotedMarkdownCell = `# %% [markdown]\n'''\n${markdownBody}\n'''`;
				const doubleQuotedMarkdownCell = `# %% [markdown]\n"""\n${markdownBody}\n"""`;

				const parser = getParser(language);

				test(
					'Has a parser',
					() => {
						assert.ok(parser);
					}
				);

				const singleCellTests: [string, string, CellType][] = [
					['Parses a single code cell', codeCell, CellType.Code],
					['Parses a single markdown cell', commentedMarkdownCell, CellType.Markdown],
				];
				singleCellTests.forEach(([title, content, expectedType]) => {
					test(
						title,
						async () => {
							const [document, cell] = await createDocumentAndSingleCell(language, content, expectedType);
							assert.deepStrictEqual(parseCells(document), [cell]);
						}
					);
				});

				test(
					'Parses multiple cells',
					async () => {
						const content = [codeCell, commentedMarkdownCell].join('\n');
						const document = await createDocument(language, content);
						assert.deepStrictEqual(parseCells(document), [
							{
								range: new vscode.Range(0, 0, 2, 3),
								type: CellType.Code,
							},
							{
								range: new vscode.Range(3, 0, 7, 22),
								type: CellType.Markdown,
							}]);
					}
				);

				const getCellTypeTests: [string, string, CellType][] = [
					['Get the cell type for a code cell', codeCell, CellType.Code],
					['Get the cell type for a markdown cell', commentedMarkdownCell, CellType.Markdown],
				];
				getCellTypeTests.forEach(([title, content, expectedType]) => {
					test(
						title,
						() => {
							assert.deepStrictEqual(parser?.getCellType(content.split('\n')[0]), expectedType);
						}
					);
				});

				const expectedMarkdownText = `%%markdown\n${markdownBody}\n\n`;
				const getCellTextTests: [string, string, CellType, string][] = [
					['Get the cell text for a code cell', codeCell, CellType.Code, codeCellBody],
					['Get the cell text for a commented markdown cell', commentedMarkdownCell, CellType.Markdown, expectedMarkdownText],
					['Get the cell text for a single-quoted markdown cell', singleQuotedMarkdownCell, CellType.Markdown, expectedMarkdownText],
					['Get the cell text for a double-quoted markdown cell', doubleQuotedMarkdownCell, CellType.Markdown, expectedMarkdownText],
				];
				getCellTextTests.forEach(([title, content, expectedType, expectedText]) => {
					test(
						title,
						async () => {
							const [document, cell] = await createDocumentAndSingleCell(language, content, expectedType);
							assert.deepStrictEqual(parser?.getCellText(cell, document), expectedText);
						}
					);
				});

				test(
					'New cell',
					async () => {
						assert.deepStrictEqual(parser?.newCell(), '\n# %%\n');
					}
				);

				test(
					'Cell decoration setting',
					async () => {
						assert.deepStrictEqual(parser?.cellDecorationSetting(), CellDecorationSetting.Current);
					}
				);
			}
		);

		suite(
			'R Parser',
			() => {
				const language = 'r';
				const codeCellBody = '123\n456';
				const codeCell1 = `#+\n${codeCellBody}`;
				const codeCell2 = `#+\n789\n012`;

				const parser = getParser(language);

				test(
					'Has a parser',
					() => {
						assert.ok(parser);
					}
				);

				const singleCellTests: [string, string, CellType][] = [
					['Parses a single code cell', codeCell1, CellType.Code],
				];
				singleCellTests.forEach(([title, content, expectedType]) => {
					test(
						title,
						async () => {
							const [document, cell] = await createDocumentAndSingleCell(language, content, expectedType);
							assert.deepStrictEqual(parseCells(document), [cell]);
						}
					);
				});

				test(
					'Parses multiple cells',
					async () => {
						const content = [codeCell1, codeCell2].join('\n\n');
						const document = await createDocument(language, content);
						assert.deepStrictEqual(parseCells(document), [
							{
								range: new vscode.Range(0, 0, 2, 3),
								type: CellType.Code,
							},
							{
								range: new vscode.Range(4, 0, 6, 3),
								type: CellType.Code,
							}]);
					}
				);

				const getCellTypeTests: [string, string, CellType][] = [
					['Get the cell type for a code cell', codeCell1, CellType.Code],
				];
				getCellTypeTests.forEach(([title, content, expectedType]) => {
					test(
						title,
						() => {
							assert.deepStrictEqual(parser?.getCellType(content.split('\n')[0]), expectedType);
						}
					);
				});

				const getCellTextTests: [string, string, CellType, string][] = [
					['Get the cell text for a code cell', codeCell1, CellType.Code, codeCellBody],
				];
				getCellTextTests.forEach(([title, content, expectedType, expectedText]) => {
					test(
						title,
						async () => {
							const [document, cell] = await createDocumentAndSingleCell(language, content, expectedType);
							assert.deepStrictEqual(parser?.getCellText(cell, document), expectedText);
						}
					);
				});

				test(
					'New cell',
					async () => {
						assert.deepStrictEqual(parser?.newCell(), '\n\n#+');
					}
				);

				test(
					'Cell decoration setting',
					async () => {
						assert.deepStrictEqual(parser?.cellDecorationSetting(), CellDecorationSetting.All);
					}
				);
			}
		);
	}
);
