# Kallichore Client

This folder contains the Kallichore client library. It is entirely code
generated from the Kallichore API definition using the OpenAPI generator's
`typescript-axios` mode.

Because it is code-generated, it is excluded from hygiene checks during the
build process. However, the editor may still show linting errors in the
generated code. These errors can be ignored.

> [!NOTE]
>
> **Do not edit the files in this folder directly.** To make changes to the
> client library, edit the OpenAPI definition (in `kallichore.json` in the main
> Kallichore repository) and then run the code generation script in
> `scripts/regen-api.sh`
