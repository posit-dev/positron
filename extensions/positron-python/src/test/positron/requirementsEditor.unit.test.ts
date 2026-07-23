/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import {
    appendPackage,
    isPackageDeclared,
    parseRequirements,
    removePackage,
} from '../../client/positron/packages/requirementsEditor';

suite('requirementsEditor', () => {
    suite('parseRequirements', () => {
        test('parses plain, continuation, and hash entries; ignores options/comments/blanks', () => {
            const content = [
                '# a comment',
                '',
                'flask==2.2.0',
                '-r other.txt',
                '-e ./local',
                'requests \\',
                '    --hash=sha256:abc \\',
                '    --hash=sha256:def',
                '--index-url https://example.com',
                'numpy',
            ].join('\n');
            const entries = parseRequirements(content).map((e) => [e.normalizedName, e.startLine, e.endLine]);
            expect(entries).to.deep.equal([
                ['flask', 2, 2],
                ['requests', 5, 7],
                ['numpy', 9, 9],
            ]);
        });
    });

    suite('isPackageDeclared', () => {
        test('matches under PEP 503 normalization', () => {
            const content = 'Flask-Login==0.6\n';
            expect(isPackageDeclared(content, 'flask_login')).to.equal(true);
            expect(isPackageDeclared(content, 'flask')).to.equal(false);
        });
    });

    suite('appendPackage', () => {
        test('appends a bare name and ensures a trailing newline', () => {
            expect(appendPackage('flask==2.2.0\n', 'pandas')).to.equal('flask==2.2.0\npandas\n');
            expect(appendPackage('flask==2.2.0', 'pandas')).to.equal('flask==2.2.0\npandas\n');
            expect(appendPackage('', 'pandas')).to.equal('pandas\n');
        });

        test('is a no-op when already declared (any pin form)', () => {
            const content = 'pandas>=1.0\n';
            expect(appendPackage(content, 'Pandas')).to.equal(content);
        });
    });

    suite('removePackage', () => {
        test('removes a plain entry and preserves the rest verbatim', () => {
            const content = '# keep\nflask==2.2.0\nrequests\n';
            expect(removePackage(content, 'flask')).to.equal('# keep\nrequests\n');
        });

        test('removes a multi-line entry including continuation and hash lines', () => {
            const content = ['requests \\', '    --hash=sha256:abc', 'flask==2.2.0', ''].join('\n');
            expect(removePackage(content, 'requests')).to.equal('flask==2.2.0\n');
        });

        test('is a no-op when not declared', () => {
            const content = 'flask==2.2.0\n';
            expect(removePackage(content, 'pandas')).to.equal(content);
        });
    });
});
