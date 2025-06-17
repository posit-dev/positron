<style-r>
When writing R code you generally follow tidyverse coding style and principles.

You use the modern `|>` pipe.
You use the testthat framework for unit testing.
You suggest and use the usethis package to perform common workflow tasks.

If the USER asks you to use base R, data.table, or any other coding style or framework, you switch to using these frameworks without mentioning anything else about it. You remember for the entire conversation to use the requested alternate setup.
</style-r>

<examples-r>
## Basic Data Transformation with filter()

```r
# Filter flights that departed on January 1st and had a departure delay
flights_jan1_delayed <- flights |>
  filter(month == 1, day == 1, dep_delay > 0)
```

## Basic Data Transformation with arrange()

```r
# Arrange flights by departure delay in descending order to find most delayed
most_delayed_flights <- flights |>
  arrange(desc(dep_delay))
```

## Basic Data Transformation with mutate()

```r
# Calculate gain (difference between departure and arrival delay) and speed
flights_with_metrics <- flights |>
  mutate(
    gain = dep_delay - arr_delay,
    speed = distance / (air_time / 60) # speed in mph
  )
```

## Basic Data Transformation with select() and rename()

```r
# Select and rename columns for clarity
selected_flight_info <- flights |>
  select(
    flight_year = year,
    flight_month = month,
    flight_day = day,
    carrier,
    flight_number = flight,
    actual_dep_time = dep_time
  )
```

## Summarizing Data with group_by() and summarize()

```r
# Calculate average departure delay and total flights per carrier
carrier_performance <- flights |>
  group_by(carrier) |>
  summarize(
    avg_dep_delay = mean(dep_delay, na.rm = TRUE),
    total_flights = n(),
    .groups = "drop" # Drop grouping after summarizing
  ) |>
  arrange(avg_dep_delay)
```

## Counting Unique Values with count() and n_distinct()

```r
# Count unique destinations per origin
unique_dest_per_origin <- flights |>
  group_by(origin) |>
  summarize(
    num_destinations = n_distinct(dest),
    .groups = "drop"
  ) |>
  arrange(desc(num_destinations))
```

## Working with Missing Values using is.na() and if_else()

```r
# Identify cancelled flights and calculate percentage of cancelled flights per day
daily_cancellations <- flights |>
  group_by(year, month, day) |>
  summarize(
    total_flights = n(),
    cancelled_flights = sum(is.na(dep_time)),
    prop_cancelled = mean(is.na(dep_time)), # Mean of logical is proportion of TRUE
    .groups = "drop"
  )
```

## Conditional Logic with case_when()

```r
# Categorize flight delays into descriptive groups
flights_with_status <- flights |>
  mutate(
    status = case_when(
      is.na(arr_delay)      ~ "Cancelled",
      arr_delay < -30       ~ "Very Early",
      arr_delay < 0         ~ "Early",
      arr_delay <= 15       ~ "On Time",
      arr_delay < 60        ~ "Late",
      arr_delay >= 60       ~ "Very Late"
    )
  )
```

## Basic Data Visualization with ggplot2

```r
# Create a scatter plot of flipper length vs. body mass, colored by species
ggplot(penguins, aes(x = flipper_length_mm, y = body_mass_g, color = species)) +
  geom_point() +
  labs(
    title = "Penguin Flipper Length vs. Body Mass",
    x = "Flipper Length (mm)",
    y = "Body Mass (g)",
    color = "Species"
  )
```

## Customizing Plot Labels and Aesthetics

```r
# Customize axis labels, title, and use a colorblind-safe palette
ggplot(penguins, aes(x = flipper_length_mm, y = body_mass_g, color = species)) +
  geom_point(aes(shape = species)) + # Add shape mapping for accessibility
  geom_smooth(method = "lm", se = FALSE) + # Add linear regression line without std error
  labs(
    title = "Relationship between Flipper Length and Body Mass for Penguins",
    subtitle = "Data from Palmer Archipelago LTER",
    x = "Flipper Length (mm)",
    y = "Body Mass (g)",
    color = "Penguin Species",
    shape = "Penguin Species",
    caption = "Source: palmerpenguins package"
  ) +
  ggthemes::scale_color_colorblind() # Use a colorblind-safe palette
```

## Faceting Plots

```r
# Create faceted plots to show relationships per island
ggplot(penguins, aes(x = flipper_length_mm, y = body_mass_g)) +
  geom_point(aes(color = species)) +
  facet_wrap(~island, scales = "free") + # Allow independent scales for better comparison
  labs(title = "Penguin Dimensions by Island and Species")
```

## Working with Factors: Reordering Levels

```r
# Reorder 'cut' levels in diamonds by median price for better visualization
diamonds_reordered_cut <- diamonds |>
  mutate(cut = fct_reorder(cut, price, .fun = median, na.rm = TRUE)) |>
  ggplot(aes(x = cut, y = price)) +
  geom_boxplot() +
  labs(title = "Diamond Price Distribution by Cut (reordered by median price)")
```

## Working with Factors: Recoding and Lumpings Levels

```r
# Recode `partyid` for simplification and then lump infrequent categories
gss_cat_simplified_partyid <- gss_cat |>
  mutate(
    partyid_recoded = fct_recode(partyid,
      "Republican" = "Strong republican",
      "Republican" = "Not str republican",
      "Independent" = "Ind,near rep",
      "Independent" = "Independent",
      "Independent" = "Ind,near dem",
      "Democrat" = "Not str democrat",
      "Democrat" = "Strong democrat",
      "Other" = "No answer",
      "Other" = "Don't know",
      "Other" = "Other party"
    ),
    relig_lumped = fct_lump_n(relig, n = 5) # Keep top 5 most frequent religions
  ) |>
  count(partyid_recoded, relig_lumped)
```

## Working with Strings: str_detect() and str_count()

```r
# Find baby names containing "qu" and count their occurrences
qu_names <- babynames |>
  filter(str_detect(name, "qu")) |>
  mutate(qu_count = str_count(name, "qu")) |>
  arrange(desc(qu_count))
```

## Working with Strings: str_replace_all() and str_remove_all()

```r
# Clean a messy string by removing non-alphanumeric characters and replacing spaces with underscores
messy_string <- "  This Is A_Messy String! 123 "
cleaned_string <- messy_string |>
  str_remove_all("[^a-zA-Z0-9 ]") |> # Remove all non-alphanumeric except space
  str_trim() |> # Trim leading/trailing whitespace
  str_replace_all(" ", "_") |> # Replace spaces with underscores
  str_to_lower()
```

## Extracting Data with separate_wider_delim()

```r
# Separate a combined id string into distinct parts
product_data <- tibble(product_id = c("ABC-123-2023", "XYZ-456-2022", "DEF-789-2024"))
separated_data <- product_data |>
  separate_wider_delim(
    product_id,
    delim = "-",
    names = c("category", "item_code", "year_manufactured")
  )
```

## Working with Dates and Times: make_datetime() and Accessors

```r
# Convert year, month, day, hour, minute columns into a single datetime object
flights_datetime <- flights |>
  mutate(
    dep_datetime = make_datetime(year, month, day, dep_time %/% 100, dep_time %% 100),
    arr_datetime = make_datetime(year, month, day, arr_time %/% 100, arr_time %% 100)
  ) |>
  # Correct for overnight flights if arrival time appears before departure
  mutate(
    arr_datetime = if_else(arr_datetime < dep_datetime, arr_datetime + days(1), arr_datetime)
  )
```

## Working with Dates and Times: Durations and Periods

```r
# Calculate actual flight duration and scheduled flight duration
flight_durations <- flights_datetime |>
  mutate(
    actual_duration = arr_datetime - dep_datetime, # Returns a difftime
    scheduled_duration = sched_arr_time - sched_dep_time # Assuming sched_arr_time is also made correctly
  ) |>
  # Convert to standard lubridate durations for consistency
  mutate(
    actual_duration_s = as.duration(actual_duration),
    scheduled_duration_s = as.duration(scheduled_duration)
  )
```

## Joining Data Frames with left_join()

```r
# Join flight data with airline names using carrier code
flights_with_airline_names <- flights |>
  left_join(airlines, join_by(carrier))
```

## Iteration with across()

```r
# Calculate mean and standard deviation for all numeric columns in diamonds data
diamonds_summary_numeric <- diamonds |>
  summarize(
    across(where(is.numeric), list(mean = mean, sd = sd), na.rm = TRUE),
    .groups = "drop"
  )
```
</examples-r>
