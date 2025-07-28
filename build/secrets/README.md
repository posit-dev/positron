# Secrets Scanning

We use [detect-secrets](https://github.com/Yelp/detect-secrets) to scan for possible secrets in staged files.

For more information on how to use detect-secrets, see the [detect-secrets documentation](https://github.com/Yelp/detect-secrets).

A wrapper script [detect-secrets.js](../detect-secrets.js) is used to run detect-secrets with the appropriate configuration and baseline secrets file.

## Installation

Install detect-secrets via `pip install detect-secrets` (Python and pip installed already) or `brew install detect-secrets` (MacOS).

## Pre-commit hook
The pre-commit hook associated with the `hygiene` command will run `detect-secrets-hook` on staged files and fail if any secrets are found (if the secrets are not already in the baseline secrets file).

If you feel like something is going wrong with the pre-commit hook, you can run `node ./build/detect-secrets.js run-hook --debug` to run the hook manually with additional debug output. You can copy the generated `detect-secrets-hook` command and run it in your terminal with an additional option `--verbose` to debug further.

If you're committing changes that modify the line number of a previously detected secret (false positive or otherwise) in the baseline file, `detect-secrets` will automatically update the baseline file with the new line number and fail the commit so you can add the updated baseline file to your commit.

If the baseline file _doesn't_ get updated automatically, follow the instructions on [updating the baseline secrets file](#updating-the-baseline-secrets-file) to manually update the baseline file.

### Example
`my_secret` on line 2 is already captured in the baseline secrets file.
```js
const hello = "hello";         // line 1
const my_secret = "my_secret"  // line 2
```

If `puppies` is inserted at line 2, `detect-secrets` will fail the commit and update the baseline secrets file to list `my_secret` on line 3. You can then add the updated baseline secrets file to your commit.
```diff
const hello = "hello";         // line 1
+ const puppies = "puppies";   // line 2
const my_secret = "my_secret"  // line 3
```

## False positives
If you are receiving false positives from the pre-commit hook, you can update the baseline secrets file to mark the detected "secrets" as okay to commit.

First, update the baseline secrets file to include the new strings. Then, run the audit command to mark the new strings as false positives. Once complete, commit the updated baseline secrets file.

### Updating the baseline secrets file

> [!IMPORTANT]
> ⚠️ Windows users: please use a Mac or Linux machine to run the following commands, as the `detect-secrets` tool will rewrite all file paths to use Windows-style paths, which will cause all of the baseline file entries to be marked as new secrets that need to be audited again.

From the root of the project:
1. Run `node ./build/detect-secrets.js update-baseline` to scan for new secrets and update the baseline secrets file
2. See [Auditing the baseline secrets file](#auditing-the-baseline-secrets-file) below to audit the baseline secrets file
3. Commit the updated baseline secrets file

See [detect-secrets documentation](https://github.com/Yelp/detect-secrets/tree/master?tab=readme-ov-file#adding-new-secrets-to-baseline) for more details.

### Auditing the baseline secrets file
From the root of the project:
1. Run `node ./build/detect-secrets.js audit-baseline` to audit the baseline secrets file (flag each secret as either true or false positive).
    - If there are new secrets in the baseline file that are unrelated to your changes, notify the team. You can skip them in the audit as you assess the other detected secrets, but they should be addressed before committing the updated baseline file.
    - If you see the error `ERROR: Secret not found on line <LINE_NUMBER>! Try recreating your baseline to fix this issue.`, **_do not_** recreate the baseline file (i.e., **don't** run `node ./build/detect-secrets.js init-baseline`, as the marked false and true positives metadata may be lost). Instead, follow the instructions on [updating the baseline secrets file](#updating-the-baseline-secrets-file), which should automatically remove outdated secrets (i.e., if the secret no longer exists or the line number has changed).

## Report of secrets found
From the root of the project:
1. Run `node ./build/detect-secrets.js generate-report`.
    - The output is similar to the output of `node ./build/detect-secrets.js audit-baseline` but in JSON format.
    - `secrets_report[_pro].json` will not be committed as it is `.gitignore`-d

## Filtering secrets
We currently only use the built-in filtering mechanism `--exclude-files` to filter out secrets in specific files, file name patterns and directories. These directories contain third-party code that we do not want to scan for secrets.

See the `excludeFiles` array in the [detect-secrets.js script](../detect-secrets.js) for the list of files, file name patterns and directories that are excluded.

For some external files which may only include a couple of false positive secrets, we may have included them in the baseline secrets file.

For more on filters, see the [detect-secrets README](https://github.com/Yelp/detect-secrets/tree/master?tab=readme-ov-file#filters) or further details on writing [custom filters](https://github.com/Yelp/detect-secrets/blob/master/docs/filters.md#Using-Your-Own-Filters).

---

<details>
<summary>Initial Setup (only needed once)</summary>

It's best to refer to [detect-secrets](https://github.com/Yelp/detect-secrets) for the most up-to-date instructions, but here are the steps that were used to set up the initial baseline secrets file.

From the root of the project:
1. Run `node ./build/detect-secrets.js init-baseline` to generate the initial baseline secrets file
2. Run `node ./build/detect-secrets.js audit-baseline` to audit the baseline secrets file (flag each secret as either true or false positive)
3. Commit the baseline secrets file

</details>
