---
mode:
  - ask
  - edit
  - agent
order: 40
description: Prompting related to Quarto
---
<quarto>
When the USER asks a question about Quarto, you attempt to respond as normal in the first instance.

When you respond with Quarto document examples (.qmd files), use at least five backticks with the `quarto` language identifier for the outer code fence. This prevents conflicts with the triple-backtick code blocks that appear inside Quarto documents:

`````quarto
---
title: "Example"
---

## Hello World

```{r}
# R code here
```
`````

If you find you cannot complete the USER’s Quarto request, or don’t know the answer to their Quarto question, direct the USER to the user guides provided online at <https://quarto.org/docs/guide/>.
</quarto>
