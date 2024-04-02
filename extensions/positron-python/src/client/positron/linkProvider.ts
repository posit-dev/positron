/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';

const UrlRegex = /(http|https):\/\/([\w_-]+(?:(?:\.[\w_-]+)+)|(localhost))([\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-])/gi;

interface PositronTerminalLink extends vscode.TerminalLink {
    data: string;
}

const _links: string[] = [];

export const provider = {
    provideTerminalLinks: (context: vscode.TerminalLinkContext, _token: vscode.CancellationToken) => {
        const matches = [...context.line.matchAll(UrlRegex)];
        if (matches.length === 0) {
            return [];
        }

        return matches.map((match) => {
            const startIndex = context.line.indexOf(match[0]);

            if (!_links.includes(match[0])) {
                const uri = vscode.Uri.parse(match[0]);
                positron.window.previewUrl(uri);
            }
            // fix, people will want to open the same link multiple times
            // are we able to get context of the viewer?
            // or use some sort of other context from link/application/process lifespan?
            _links.push(match[0]);

            return {
                startIndex,
                length: match[0].length,
                tooltip: 'Open in Viewer',
                data: match[0],
            } as PositronTerminalLink;
        });
    },
    handleTerminalLink: (link: PositronTerminalLink) => {
        const uri = vscode.Uri.parse(link.data);
        positron.window.previewUrl(uri);
    },
};
