/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import { addRequirement, removeRequirement } from '../../client/positron/packages/requirementsEditor';

suite('requirementsEditor Tests', () => {
    suite('addRequirement', () => {
        test('appends an annotated bare name', () => {
            expect(addRequirement('flask==2.2.0\n', 'pandas')).to.equal('flask==2.2.0\npandas  # added by Positron\n');
        });

        test('adds a newline before appending when the file lacks one', () => {
            expect(addRequirement('flask', 'pandas')).to.equal('flask\npandas  # added by Positron\n');
        });

        test('appends to an empty file', () => {
            expect(addRequirement('', 'pandas')).to.equal('pandas  # added by Positron\n');
        });

        test('keeps CRLF line endings', () => {
            expect(addRequirement('flask\r\n', 'pandas')).to.equal('flask\r\npandas  # added by Positron\r\n');
        });

        test('leaves an already-declared package untouched, matching per PEP 503', () => {
            const content = '# deps\nScikit_Learn>=1.0\n';
            expect(addRequirement(content, 'scikit-learn')).to.equal(content);
        });

        test('does not treat comments or options as declarations', () => {
            const content = '# pandas\n-e ./pandas\n';
            expect(addRequirement(content, 'pandas')).to.equal(`${content}pandas  # added by Positron\n`);
        });

        test('replaces a "removed by Positron" comment in place', () => {
            expect(addRequirement('flask\n# Requests removed by Positron\nnumpy\n', 'requests')).to.equal(
                'flask\nrequests  # added by Positron\nnumpy\n',
            );
        });

        test('keeps CRLF when replacing a "removed by Positron" comment', () => {
            expect(addRequirement('# requests removed by Positron\r\nflask\r\n', 'requests')).to.equal(
                'requests  # added by Positron\r\nflask\r\n',
            );
        });
    });

    suite('removeRequirement', () => {
        test('replaces the entry with a "removed by Positron" comment, using the declared name', () => {
            expect(removeRequirement('flask\nRequests==2.28.2\nnumpy\n', 'requests')).to.equal(
                'flask\n# Requests removed by Positron\nnumpy\n',
            );
        });

        test('removes the whole span of a hashed, continued entry', () => {
            const content = [
                'flask==2.2.0',
                'requests==2.28.2 \\',
                '    --hash=sha256:aaa \\',
                '    --hash=sha256:bbb',
                'numpy',
                '',
            ].join('\n');
            expect(removeRequirement(content, 'requests')).to.equal(
                'flask==2.2.0\n# requests removed by Positron\nnumpy\n',
            );
        });

        test('removes hash lines on their own lines without continuations', () => {
            const content = 'requests==2.28.2\n    --hash=sha256:aaa\nnumpy\n';
            expect(removeRequirement(content, 'requests')).to.equal('# requests removed by Positron\nnumpy\n');
        });

        test('does not treat a trailing backslash on a comment as a continuation', () => {
            const content = '# note \\\nrequests\n';
            expect(removeRequirement(content, 'requests')).to.equal('# note \\\n# requests removed by Positron\n');
        });

        test('deletes a Positron-added entry outright', () => {
            expect(removeRequirement('flask\npandas  # added by Positron\n', 'pandas')).to.equal('flask\n');
        });

        test('leaves a single comment when the package is declared more than once', () => {
            const content = 'foo; python_version < "3.9"\nflask\nfoo>=2; python_version >= "3.9"\n';
            expect(removeRequirement(content, 'foo')).to.equal('# foo removed by Positron\nflask\n');
        });

        test('keeps CRLF line endings', () => {
            expect(removeRequirement('flask\r\nrequests\r\n', 'requests')).to.equal(
                'flask\r\n# requests removed by Positron\r\n',
            );
        });

        test('leaves undeclared packages, comments, and editables untouched', () => {
            const content = '# requests\n-e ./requests\nflask\n';
            expect(removeRequirement(content, 'requests')).to.equal(content);
        });

        test('round-trips an install then uninstall back to the original file', () => {
            const content = 'flask==2.2.0\n';
            expect(removeRequirement(addRequirement(content, 'pandas'), 'pandas')).to.equal(content);
        });

        test('round-trips an uninstall then reinstall to an annotated entry', () => {
            expect(addRequirement(removeRequirement('requests==2.28.2\n', 'requests'), 'requests')).to.equal(
                'requests  # added by Positron\n',
            );
        });
    });
});
