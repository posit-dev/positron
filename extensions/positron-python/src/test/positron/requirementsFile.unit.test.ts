/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import {
    appendBareIfAbsent,
    buildRequirementsFile,
    extractRequirementName,
    normalizePackageName,
    parseRequirements,
    recordUpdate,
    removeRequirement,
    RequirementEntry,
    setRequirement,
} from '../../client/positron/packages/requirementsFile';

suite('requirementsFile Tests', () => {
    suite('normalizePackageName', () => {
        test('lowercases and collapses separators per PEP 503', () => {
            expect(normalizePackageName('Flask')).to.equal('flask');
            expect(normalizePackageName('typing_extensions')).to.equal('typing-extensions');
            expect(normalizePackageName('zope.interface')).to.equal('zope-interface');
            expect(normalizePackageName('Foo--_.Bar')).to.equal('foo-bar');
        });
    });

    suite('extractRequirementName', () => {
        test('reads the name from a pinned spec', () => {
            expect(extractRequirementName('Werkzeug==2.0.3')).to.equal('Werkzeug');
        });

        test('reads the name from a direct-reference spec', () => {
            expect(extractRequirementName('positron-update-demo @ file:///tmp/demo')).to.equal('positron-update-demo');
        });

        test('ignores comments, blanks, options, and editables', () => {
            expect(extractRequirementName('')).to.equal(undefined);
            expect(extractRequirementName('   ')).to.equal(undefined);
            expect(extractRequirementName('# a comment')).to.equal(undefined);
            expect(extractRequirementName('--index-url https://example.com')).to.equal(undefined);
            expect(extractRequirementName('-e /path/to/pkg')).to.equal(undefined);
        });
    });

    suite('buildRequirementsFile', () => {
        test('bare-names plain PyPI pins and pins the target', () => {
            const lines = ['flask==2.2.0', 'Werkzeug==2.0.3', 'positron-update-demo @ file:///tmp/demo'];
            const result = buildRequirementsFile(lines, [{ name: 'werkzeug', version: '3.1.8' }]);
            expect(result).to.equal(
                ['flask', 'werkzeug==3.1.8', 'positron-update-demo @ file:///tmp/demo'].join('\n') + '\n',
            );
        });

        test('keeps origin lines (direct reference and editable) verbatim', () => {
            const lines = ['pkg @ file:///tmp/pkg', '-e /tmp/editable', 'requests==2.28.0'];
            const result = buildRequirementsFile(lines, []);
            expect(result).to.equal(['pkg @ file:///tmp/pkg', '-e /tmp/editable', 'requests'].join('\n') + '\n');
        });

        test('with no targets (Update All) leaves everything bare or verbatim', () => {
            const lines = ['flask==2.2.0', 'werkzeug==2.0.3'];
            const result = buildRequirementsFile(lines, []);
            expect(result).to.equal(['flask', 'werkzeug'].join('\n') + '\n');
        });

        test('matches the target case-insensitively on the normalized name', () => {
            const lines = ['Typing_Extensions==4.0.0'];
            const result = buildRequirementsFile(lines, [{ name: 'typing-extensions', version: '4.9.0' }]);
            expect(result).to.equal('typing-extensions==4.9.0\n');
        });

        test('pins multiple targets for a multi-package update', () => {
            const lines = ['flask==2.2.0', 'werkzeug==2.0.3', 'requests==2.28.0'];
            const result = buildRequirementsFile(lines, [
                { name: 'flask', version: '3.0.0' },
                { name: 'requests', version: '2.31.0' },
            ]);
            expect(result).to.equal(['flask==3.0.0', 'werkzeug', 'requests==2.31.0'].join('\n') + '\n');
        });

        test('filters the pkg-resources==0.0.0 junk line and blank lines', () => {
            const lines = ['pkg-resources==0.0.0', '', 'flask==2.2.0'];
            const result = buildRequirementsFile(lines, []);
            expect(result).to.equal('flask\n');
        });

        test('appends a target absent from the freeze output', () => {
            const lines = ['flask==2.2.0'];
            const result = buildRequirementsFile(lines, [{ name: 'requests', version: '2.31.0' }]);
            expect(result).to.equal(['flask', 'requests==2.31.0'].join('\n') + '\n');
        });

        test('pins a target even when its freeze line is a direct reference', () => {
            const result = buildRequirementsFile(['foo @ file:///x'], [{ name: 'foo', version: '2.0' }]);
            expect(result).to.equal('foo==2.0\n');
        });

        test('appends a versionless target as a bare name', () => {
            const result = buildRequirementsFile(['flask==2.2.0'], [{ name: 'requests' }]);
            expect(result).to.equal(['flask', 'requests'].join('\n') + '\n');
        });

        test('replaces a matching line with a bare name when the target has no version', () => {
            const result = buildRequirementsFile(['requests==2.28.0'], [{ name: 'requests' }]);
            expect(result).to.equal('requests\n');
        });
    });

    suite('parseRequirements', () => {
        test('returns normalized name, raw name, and single-line span', () => {
            const entries = parseRequirements('Flask==2.2.0\nrequests==2.28.0\n');
            expect(entries).to.have.length(2);
            expect(entries[0]).to.deep.include({
                normalizedName: 'flask',
                rawName: 'Flask',
                startLine: 0,
                endLine: 0,
            });
            expect(entries[1].normalizedName).to.equal('requests');
        });

        test('captures extras without brackets', () => {
            const entries = parseRequirements('requests[security,socks]==2.28.0\n');
            expect(entries[0].normalizedName).to.equal('requests');
            expect(entries[0].extras).to.equal('security,socks');
        });

        test('spans backslash line-continuations (hashes) into one entry', () => {
            const content = 'foo==1.0 \\\n    --hash=sha256:aaa \\\n    --hash=sha256:bbb\nbar==2.0\n';
            const entries = parseRequirements(content);
            expect(entries).to.have.length(2);
            expect(entries[0]).to.deep.include({ normalizedName: 'foo', startLine: 0, endLine: 2 });
            expect(entries[1]).to.deep.include({ normalizedName: 'bar', startLine: 3, endLine: 3 });
        });

        test('skips comments, blanks, options, and editables', () => {
            const content = '# comment\n\n--index-url https://x\n-e ./pkg\nflask==2.2.0\n';
            const entries = parseRequirements(content);
            expect(entries).to.have.length(1);
            expect(entries[0].normalizedName).to.equal('flask');
            expect(entries[0].startLine).to.equal(4);
        });
    });

    suite('setRequirement', () => {
        test('replaces a matching entry with name==version', () => {
            expect(setRequirement('flask==2.2.0\nrequests==2.28.0\n', 'requests', '2.31.0')).to.equal(
                'flask==2.2.0\nrequests==2.31.0\n',
            );
        });

        test('preserves declared extras when pinning', () => {
            expect(setRequirement('requests[security,socks]>=2,<3\n', 'requests', '2.31.0')).to.equal(
                'requests[security,socks]==2.31.0\n',
            );
        });

        test('matches case-insensitively on the normalized name', () => {
            expect(setRequirement('Typing_Extensions==4.0.0\n', 'typing-extensions', '4.9.0')).to.equal(
                'typing-extensions==4.9.0\n',
            );
        });

        test('appends when the target is absent', () => {
            expect(setRequirement('flask==2.2.0\n', 'requests', '2.31.0')).to.equal('flask==2.2.0\nrequests==2.31.0\n');
        });

        test('replaces a backslash-continued entry as a single line', () => {
            const content = 'foo==1.0 \\\n    --hash=sha256:aaa\nbar==2.0\n';
            expect(setRequirement(content, 'foo', '1.5')).to.equal('foo==1.5\nbar==2.0\n');
        });

        test('writes a bare name when no version is given', () => {
            expect(setRequirement('requests==2.28.0\n', 'requests')).to.equal('requests\n');
        });
    });

    suite('appendBareIfAbsent', () => {
        test('appends a bare name when absent', () => {
            expect(appendBareIfAbsent('flask==2.2.0\n', 'requests')).to.equal('flask==2.2.0\nrequests\n');
        });

        test('leaves content unchanged when already declared (any form)', () => {
            expect(appendBareIfAbsent('requests==2.28.0\n', 'Requests')).to.equal('requests==2.28.0\n');
        });

        test('appends a trailing newline if the file lacks one', () => {
            expect(appendBareIfAbsent('flask==2.2.0', 'requests')).to.equal('flask==2.2.0\nrequests\n');
        });
    });

    suite('recordUpdate', () => {
        test('bumps an exact pin to the new version', () => {
            expect(recordUpdate('flask==1.0\nrequests==2.28.0\n', 'requests', '2.31.0')).to.equal(
                'flask==1.0\nrequests==2.31.0\n',
            );
        });

        test('preserves extras when bumping an exact pin', () => {
            expect(recordUpdate('requests[security]==2.28.0\n', 'requests', '2.31.0')).to.equal(
                'requests[security]==2.31.0\n',
            );
        });

        test('leaves a range untouched', () => {
            expect(recordUpdate('requests>=2,<3\n', 'requests', '2.31.0')).to.equal('requests>=2,<3\n');
        });

        test('leaves a bare name untouched', () => {
            expect(recordUpdate('requests\n', 'requests', '2.31.0')).to.equal('requests\n');
        });

        test('appends a bare name when the target is undeclared', () => {
            expect(recordUpdate('flask==1.0\n', 'requests', '2.31.0')).to.equal('flask==1.0\nrequests\n');
        });
    });

    suite('removeRequirement', () => {
        test('removes a single-line entry', () => {
            expect(removeRequirement('flask==1.0\nrequests==2.28.0\n', 'requests')).to.equal('flask==1.0\n');
        });

        test('removes a backslash-continued entry and its hash lines', () => {
            const content = 'flask==1.0\nfoo==1.0 \\\n    --hash=sha256:aaa \\\n    --hash=sha256:bbb\n';
            expect(removeRequirement(content, 'foo')).to.equal('flask==1.0\n');
        });

        test('leaves content unchanged when the target is not declared', () => {
            expect(removeRequirement('flask==1.0\n', 'requests')).to.equal('flask==1.0\n');
        });
    });
});
