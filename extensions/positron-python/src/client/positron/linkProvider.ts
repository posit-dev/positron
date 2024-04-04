/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';

// Assuming localHosts is an array of localhost URLs
const localHosts: string[] = [
    'localhost',
    '127.0.0.1',
    '[0:0:0:0:0:0:0:1]',
    '[::1]',
    '0.0.0.0',
    '[0:0:0:0:0:0:0:0]',
    '[::]',
];

const urlPattern = /(http|https):\/\/([\w_-]+(?:(?:\.[\w_-]+)+)|(localhost))([\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-])/gi;
const localHostsPattern = new RegExp(
    `(?:https?:\/\/)(${localHosts.join('|')})([\\w.,@?^=%&:/~+#-]*[\\w@?^=%&/~/+#-])`,
    'gi',
);

interface PositronTerminalLink extends vscode.TerminalLink {
    data: string;
    openInViewer: boolean;
}

const _links: Map<Thenable<number | undefined>, string> = new Map();

export function provideTerminalLinks(
    context: vscode.TerminalLinkContext,
    _token: vscode.CancellationToken,
): vscode.ProviderResult<PositronTerminalLink[]> {
    const matches = [...context.line.matchAll(urlPattern)];

    if (matches.length === 0) {
        return [];
    }

    return matches.map((match) => {
        const startIndex = context.line.indexOf(match[0]);

        // if localhost, preview through viewer
        if (localHostsPattern.test(match[0])) {
            const pid = context.terminal.processId
            if (!_links.has(pid) || _links.get(pid) !== match[0]) {
                positron.window.previewUrl(vscode.Uri.parse(match[0]));

                // set pid to latest localhost address
                _links.set(pid, match[0]);

                return {
                    startIndex,
                    length: match[0].length,
                    tooltip: 'Open link in Viewer',
                    data: match[0],
                    openInViewer: true,
                } as PositronTerminalLink;
            }
        }
        // otherwise, treat as external link
        return {
            startIndex,
            length: match[0].length,
            tooltip: 'Open link in browser',
            data: match[0],
            openInViewer: false,
        } as PositronTerminalLink;
    });
}

export function handleTerminalLink(link: PositronTerminalLink): void {
    const config = vscode.workspace.getConfiguration('positron.viewer');

    if (link.openInViewer && config.get<boolean>('openLocalhostUrls')) {
        const uri = vscode.Uri.parse(link.data);
        positron.window.previewUrl(uri);
    } else {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(link.data));
    }
}
