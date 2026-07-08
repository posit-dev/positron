# This is a multi-line statement in R.
c(-1, -2, -3) |>
  abs() |>
  sqrt() |>
  sum()

# And here is another.
c(1, 2, 3) +
  c(4, 5, 6) +
  c(7, 8, 9)

# And one more for good measure.
data.frame(
  x = c(1, 2, 3),
  y = c(4, 5, 6)
) |>
  subset(x > 1) |>
  transform(z = x + y) |>
  head()
