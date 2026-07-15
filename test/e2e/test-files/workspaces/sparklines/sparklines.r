library(tidyverse)
library(generator)

state_df <- tibble(
  state_abb = state.abb,
  state_area = state.area,
  state_name = state.name,
  state_region = state.region,
  state_division = state.division
)

# likert scale for categorical
likert <- c("Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree")

# make it reproducible
set.seed(37)

# number of rows
dfr <- 1e6L

df <- tibble(
  waffle_house_id = 1:dfr,
  n_employees = sample(10:20L, size = dfr, replace = TRUE, prob = c(0.1, 0.05, 0.05, 0.2, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.3)),
  sq_foot = rnorm(dfr, mean = 3000, sd = 100),
  state_abb = sample(state.abb, size = dfr, replace = TRUE),
  date_open = as.Date(sample(seq(as.Date('1990-01-01'), as.Date('2023-12-30'), by="day"), size = dfr, replace = TRUE)),
  date_time = sample(seq(ymd_hms("1990-01-01 00:00:00 CST"), ymd_hms("2023-12-30 00:00:00 CST"), by="1 min"), size = dfr, replace = TRUE),
  phone_number = generator::r_phone_numbers(dfr, TRUE),
  lat = generator::r_latitudes(dfr),
  long = generator::r_longitudes(dfr),
  jagged = {
    jag_100 = runif(100, 1, 1000)
    sample(jag_100, dfr, replace = TRUE, prob = jag_100/sum(jag_100))
  },
  jagged_rev = {
    jag_100 = runif(100, 1, 1000)
    sample(jag_100, dfr, replace = TRUE, prob = rev(jag_100/sum(jag_100)))
  },
  # logical
  logical = sample(c(TRUE, FALSE), size = dfr, replace = TRUE),
  logical_missing = sample(c(TRUE, FALSE, NA), size = dfr, replace = TRUE, prob = c(0.45, 0.45, 0.1)),
  
  # characters and factors
  letters_single = sample(letters, size = dfr, replace = TRUE),
  likert_char = sample(likert, size = dfr, replace = TRUE),
  likert_char_na = sample(c(likert,NA), size = dfr, replace = TRUE, prob = c(0.18, 0.18, 0.18, 0.18, 0.18, 0.1)),
  likert_factor = sample(factor(likert, levels = likert), size = dfr, replace = TRUE),
  likert_factor_na = sample(factor(c(likert,NA), levels = c(likert)), size = dfr, replace = TRUE, prob = c(0.18, 0.18, 0.18, 0.18, 0.18, 0.1)),
  
  # missing percents
  na_10 = c(rnorm(dfr*0.9, 50, 5), rep(NA, times = 0.1 * dfr)),
  na_20 = c(rnorm(dfr*0.8, 50, 5), rep(NA, times = 0.2 * dfr)),
  na_50 = c(rnorm(dfr*0.5, 50, 5), rep(NA, times = 0.5 * dfr)),
  na_75 = c(rnorm(dfr*0.25, 50, 5), rep(NA, times = 0.75 * dfr)),
  na_90 = c(rnorm(dfr*0.1, 50, 5), rep(NA, times = 0.9 * dfr)),
  na_all = rep(NA, dfr),
  
  # massive scale difference
  massive_scale_diff = seq(from = 0.11, to = 8.8e7, length.out = dfr),
  massive_scale_diff_neg = seq(from = -8.8e7, to = 0.11, length.out = dfr),
  massive_scale_diff_equal_neg = seq(from = -8.8e7, to = 8.8e7, length.out = dfr),
  
  # runif 0 up
  runif_100 = runif(dfr, min = 0, max = 100),
  runif_1000 = runif(dfr, min = 0, max = 1000),
  
  # runif 0 down
  neg_runif_100 = runif(dfr, min = -100, max = 0),
  neg_runif_1000 = runif(dfr, min = -1000, max = 0),
  
  # runif 0 down
  runif_neg_100 = runif(dfr, min = -100, max = 100),
  runif_neg_1000 = runif(dfr, min = -1000, max = 1000),
  
  ## Random fits ----
  # rnorm
  rnorm_100 = rnorm(dfr, mean = 100, sd = 10),
  rnorm_1000 = rnorm(dfr, mean = 1000, sd = 10),
  rnorm_10000 = rnorm(dfr, mean = 10000, sd = 100),
  rnorm_100000 = rnorm(dfr, mean = 100000, sd = 100),
  # rbeta
  rbeta_pos_skew_100 = rbeta(dfr, 100, 1),
  rbeta_pos_skew_1000 = rbeta(dfr, 1000, 5),
  rbeta_pos_skew_10000 = rbeta(dfr, 10000, 15),
  rbeta_pos_skew_100000 = rbeta(dfr, 100000, 100),
  # rbeta_left
  rbeta_neg_skew_100 = rbeta(dfr, 1, 100),
  rbeta_neg_skew_1000 = rbeta(dfr, 5, 1000),
  rbeta_neg_skew_10000 = rbeta(dfr, 15, 10000),
  rbeta_neg_skew_100000 = rbeta(dfr, 100, 100000),
  
  ## Random negative fits ----
  # neg_rnorm
  neg_rnorm_100 = rnorm(dfr, mean = -100, sd = 10),
  neg_rnorm_1000 = rnorm(dfr, mean = -1000, sd = 100),
  neg_rnorm_10000 = rnorm(dfr, mean = -10000, sd = 1000),
  neg_rnorm_100000 = rnorm(dfr, mean = -100000, sd = 1000)
)

# join and 
waffles <- df |> 
  left_join(state_df, by = "state_abb") |> 
  relocate(starts_with("state"), .after = state_abb) |> 
  mutate(
    waffles = rnorm(dfr, 37, 4),
    size = case_when(
      sq_foot > 3100 ~ "Large",
      between(sq_foot, 2900, 3100) ~ "Medium",
      sq_foot < 2900 ~ "Small",
      TRUE ~ NA_character_
    ),
    .after = sq_foot
  )

# full dataset with dfr rows
waffles

# write out to parquet
waffles |> arrow::write_parquet("waffles.parquet")

# downsample to small data
waffles |> slice_sample(n = 10000) |> arrow::write_parquet("waffles-10k.parquet")

# downsample to medium data
waffles |> slice_sample(n = 100000) |> arrow::write_parquet("waffles-100k.parquet")