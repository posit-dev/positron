import {
    CancellationToken,
    CompletionContext,
    CompletionItem,
    CompletionItemKind,
    CompletionItemProvider,
    Disposable,
    Position,
    Range,
    TextDocument,
    languages,
} from 'vscode';
import { EnvironmentManagers } from '../../internal.api';

const ENV_PATTERN = /\s*\"python-envs\.defaultEnvManager\"\s*:\s*\"/gm;
const PKG_PATTERN = /\s*\"python-envs\.defaultPackageManager\"\s*:\s*\"/gm;

const ENV_PATTERN2 = /\s*\"envManager\"\s*:\s*\"/gm;
const PKG_PATTERN2 = /\s*\"packageManager\"\s*:\s*\"/gm;

function getRange(pos: Position, quoteIndex: number): { inserting: Range; replacing: Range } | undefined {
    if (quoteIndex === -1 || quoteIndex < pos.character) {
        return undefined;
    }
    return {
        inserting: new Range(pos.line, pos.character, pos.line, quoteIndex),
        replacing: new Range(pos.line, pos.character, pos.line, quoteIndex),
    };
}

function getCompletionItem(
    label: string,
    insertText: string,
    doc?: string,
    range?: { inserting: Range; replacing: Range },
): CompletionItem {
    const item = new CompletionItem(label);
    item.insertText = insertText;
    item.documentation = doc;
    item.kind = CompletionItemKind.Value;
    item.range = range;
    return item;
}

class ManagerSettingsProvider implements CompletionItemProvider<CompletionItem> {
    constructor(private readonly em: EnvironmentManagers) {}

    provideCompletionItems(doc: TextDocument, pos: Position, _token: CancellationToken, _context: CompletionContext) {
        const line = doc.lineAt(pos.line).text;
        const linePrefix = line.substring(0, pos.character);
        const range = getRange(pos, line.lastIndexOf('"'));

        let results: CompletionItem[] = [];
        if (ENV_PATTERN.test(linePrefix) || ENV_PATTERN2.test(linePrefix)) {
            results = this.em.managers.map((m) => getCompletionItem(m.id, m.id, m.description, range));
        } else if (PKG_PATTERN.test(linePrefix) || PKG_PATTERN2.test(linePrefix)) {
            results = this.em.packageManagers.map((m) => getCompletionItem(m.id, m.id, m.description, range));
        }
        return results;
    }
}

export function registerCompletionProvider(em: EnvironmentManagers): Disposable {
    return languages.registerCompletionItemProvider(
        { scheme: 'file', language: 'jsonc', pattern: '**/settings.json' },
        new ManagerSettingsProvider(em),
        '"',
    );
}
