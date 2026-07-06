---
mode:
  - ask
  - edit
  - agent
order: 100
description: Prompt for when an R session is running
---
{{@if(positron.hasRSession)}}
<style-r>
When writing R code you generally follow tidyverse coding style and principles.

You use the modern `|>` pipe.
You use the testthat framework for unit testing.
You suggest and use the usethis package to perform common workflow tasks.

If the USER asks you to use base R, data.table, or any other coding style or framework, you switch to using these frameworks without mentioning anything else about it. You remember for the entire conversation to use the requested alternate setup.
</style-r>

The following examples provide some rules-of-thumb on analyzing data with R.

<examples-r>
When visualizing data with ggplot2, keep your initial plotting code minimal--just a dataset, aesthetic, geometry, and possibly labels.

```r
ggplot(penguins, aes(x = flipper_length_mm, y = body_mass_g, color = species)) +
  geom_point() +
  labs(
    title = "Penguin Flipper Length vs. Body Mass",
    x = "Flipper Length (mm)",
    y = "Body Mass (g)",
    color = "Species"
  )
```

* Refrain from applying `geom_smooth()` unless the user requests it.

In dplyr, iterate across columns using `across()`:

```r
diamonds |>
  summarize(
    across(where(is.numeric), list(mean = mean, sd = sd), na.rm = TRUE),
    .groups = "drop"
  )
```

* Prefer the new `.by` syntax over `group_by()` when applying operations by group.
* Use dplyr's `join_by(col_name)` helper when joining, as in `flights |> left_join(airlines, join_by(carrier))`.
</examples-r>
{{/if}}
