# Positron publishing commands

Use these Posit Publisher commands to deploy a project to Posit Connect or
Connect Cloud and diagnose deployment failures. Read [SKILL.md]({{skill_dir}}/SKILL.md)
for invocation rules, and follow the Publisher reference in the `posit-products`
skill for the plan, confirmation, credential, and deploy sequence.

The **Arguments** and **Returns** sections are generated from command metadata,
so they match the installed build. These commands require the separately
installed Posit Publisher extension. If its metadata is unavailable, the
generated sections say `None`; tell the user to install or enable Publisher.
Do not guess arguments or use a publishing CLI as a fallback.

## Never deploy by hand

Do not run `rsconnect`, `rsconnect-python`, `quarto publish`, or another
publishing CLI through `executeCode` or a terminal. These commands reuse
Publisher credentials, update its deployment records, and return the content
URL. A CLI run can expose secrets and leave Publisher's state out of sync.

## Planning

### `posit.publisher.agent.planDeployment`

Inspects a directory and reports its detected content type, entrypoint
candidates, interpreter defaults, existing deployment records, and stored
credential names and URLs. It has no precondition.

{{command:posit.publisher.agent.planDeployment}}

Use the detected entrypoint and content type from this result; do not infer
them from the file listing. `directory` is workspace-relative here, so pass
`analysis`, not `/Users/someone/project/analysis`; omit it for the workspace
root. Credential values are redacted, and `deployContent` takes the credential
name, never a secret.

## Deploying

### `posit.publisher.agent.deployContent`

Creates missing deployment configuration and records, publishes the content,
and returns its URLs.

{{command:posit.publisher.agent.deployContent}}

Use `directory`, `entrypoint`, and `credentialName` from the plan and the
user's confirmation. Leave optional arguments unset unless needed:
`contentType` overrides detection, while `deploymentName` and
`configurationName` select existing records, so leave them unset for a first
deployment. Arguments are positional in the order shown above.

Read `status`; a successful call does not always mean that deployment happened:

- `success`: report the returned content URLs.
- `needs-credential`: use `addCredential`, then return to the deployment flow.
- `needs-content-type`: ask the user, then retry with `contentType`.
- `failed`: report the error and use a troubleshooting command; do not retry
  the same deployment blindly.

## Credentials

### `posit.publisher.agent.addCredential`

Opens Publisher's credential UI and waits for the user to finish or dismiss it.
Tell the user to complete sign-in there.

{{command:posit.publisher.agent.addCredential}}

Set `target` or `serverUrl` only when the user specified the destination.
`authMethod` applies only to a Connect server; `browser` is the default, and
`apiKey` requires an explicit user request. On `canceled` or `unavailable`,
stop and ask how to proceed; do not retry automatically.

## Troubleshooting

### `posit.publisher.agent.troubleshootDeploymentFailure`

Returns the latest logs for a deployment that ran and failed.

{{command:posit.publisher.agent.troubleshootDeploymentFailure}}

### `posit.publisher.agent.troubleshootConfigurationError`

Returns details for an invalid or suspect deployment configuration.

{{command:posit.publisher.agent.troubleshootConfigurationError}}

Interpret the returned text and give the user a diagnosis and fix. Do not paste
raw logs without explanation. Never ask for or pass an API key, password, or
token; credentials are created in Publisher and referenced by name.
