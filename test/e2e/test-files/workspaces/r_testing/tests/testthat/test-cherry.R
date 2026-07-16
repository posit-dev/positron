x <- "a"

test_that("x is 'a'", {
  expect_equal(x, "a")
})

y <- "b"

test_that("x is 'a' AND y is 'b'", {
  expect_equal(c(x, y), c("a", "b"))
})
