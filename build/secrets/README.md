# Secrets Scanning

We use [detect-secrets](https://github.com/Yelp/detect-secrets) to scan for possible secrets in staged files.

For more information on how to use detect-secrets, see the [detect-secrets documentation](https://github.com/Yelp/detect-secrets).

A wrapper script [detect-secrets.js](../detect-secrets.js) is used to run detect-secrets with the appropriate configuration and baseline secrets file.

## 🛠️ Install `detect-secrets`

Install detect-secrets via `pip install detect-secrets` (Python and pip installed already) or `brew install detect-secrets` (MacOS).

## 🏃 Run detect-secrets

### When to run `detect-secrets`?

`detect-secrets` automatically runs on staged files via the [pre-commit hook](#pre-commit-hook) when you run `git commit`.

However, `detect-secrets` must be run manually when reviewing automated PRs, such as the [Workbench extension bump PRs](https://github.com/posit-dev/positron/pulls?q=is:pr+author:app/posit-jenkins-enterprise).

### How to run `detect-secrets` manually?

> [!IMPORTANT]
> ⚠️ Windows users: please use a Mac or Linux machine to run the following commands, as the `detect-secrets` tool will rewrite all file paths to use Windows-style paths, which will cause all of the baseline file entries to be marked as new secrets that need to be audited again.

> [!TIP]
> While auditing the secrets, if you see the error `ERROR: Secret not found on line <LINE_NUMBER>! Try recreating your baseline to fix this issue.`, **_do not_** recreate the baseline file (i.e., **don't** run `node ./build/detect-secrets.js init-baseline`, as the marked false and true positives metadata may be lost). Please reach out to the team for help with this error.

The core steps are:
1. Update the baseline secrets file to include new secret-like strings
2. Audit the baseline secrets file to mark each "secret" as okay to commit or not
3. Commit the updated baseline secrets file

Use one of the following methods to update the contents of the `.secrets.baseline` file.

#### Method 1: tasks.json

The `tasks.json` file in the `.vscode` directory contains tasks to run detect-secrets commands.

In general, you'll run the `detect-secrets - update and audit baseline` task, which will run the `update-baseline` and `audit-baseline` commands in sequence.

1. Run `Tasks: Run Task` in Command Palette and select the task `detect-secrets - update and audit baseline`
2. Wait for the baseline secrets file to be updated and prepared for auditing
3. Follow the instructions in the terminal to audit the baseline secrets file, generally this involves marking false positives as "yes, should be committed"
	- If there are new secrets in the baseline file that are unrelated to your changes, notify the team. You can skip them in the audit as you assess the other detected secrets, but they should be addressed before committing the updated baseline file.
4. Commit the updated baseline secrets file

#### Method 2: `detect-secrets.js` wrapper script

We have a wrapper script [detect-secrets.js](../detect-secrets.js) that runs `detect-secrets` with the appropriate configuration, arguments, baseline secrets file, and additional logging.

1. Run the commands from the root of the project:
	```bash
	node ./build/detect-secrets.js update-baseline
	node ./build/detect-secrets.js audit-baseline
	```
2. Wait for the baseline secrets file to be updated and prepared for auditing
3. Follow the instructions in the terminal to audit the baseline secrets file, generally this involves marking false positives as "yes, should be committed"
    - If there are new secrets in the baseline file that are unrelated to your changes, notify the team. You can skip them in the audit as you assess the other detected secrets, but they should be addressed before committing the updated baseline file.
4. Commit the updated baseline secrets file

## 📚 Additional reading

Here are some additional notes on how to use `detect-secrets`, if you're having issues with the pre-commit hook or want to further customize the secrets scanning process.

### Pre-commit hook

The pre-commit hook associated with the `hygiene` command will run `detect-secrets-hook` on staged files and fail if any secret-like strings are found (if the secret-like strings are not already in the baseline secrets file or have changed).

If secret-like strings are found and your commit fails, update the baseline secrets file and mark any false positive "secrets" as okay to commit, then commit the updated baseline secrets file. See [Updating the baseline secrets file](#updating-the-baseline-secrets-file) and [Auditing the baseline secrets file](#auditing-the-baseline-secrets-file) for more details.

If you feel like something is going wrong with the pre-commit hook, you can run `node ./build/detect-secrets.js run-hook --debug` to run the hook manually with additional debug output. You can copy the generated `detect-secrets-hook` command and run it in your terminal with an additional option `--verbose` to debug further.

If you're committing changes that modify the line number of a previously detected secret (false positive or otherwise) in the baseline file, `detect-secrets` will automatically update the baseline file with the new line number and fail the commit so you can add the updated baseline file to your commit.

If the baseline file _doesn't_ get updated automatically, follow the instructions on [updating the baseline secrets file](#updating-the-baseline-secrets-file) to manually update the baseline file.

#### Example
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

### Report of secrets found

A JSON report of the detected secret-like strings can be generated. It is similar to the output of the audit command, but in JSON format instead.

To generate the report, run `node ./build/detect-secrets.js generate-report` from the root of the project. The generated file `secrets_report[_pro].json` will not be committed as it is listed in our `.gitignore`.

### Filtering secrets

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
