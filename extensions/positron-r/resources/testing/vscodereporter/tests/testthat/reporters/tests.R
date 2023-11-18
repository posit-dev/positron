test_that("Success", {
  succeed()
})

test_that("Failure:1", {
  expect_true(FALSE)
})

test_that("Failure:2a", {
  f <- function() expect_true(FALSE)
  f()
})

test_that("Error:1", {
  stop("stop")
})

test_that("errors get tracebacks", {
  f <- function() g()
  g <- function() h()
  h <- function() stop("!")

  f()
})

test_that("explicit skips are reported", {
  skip("skip")
})

test_that("empty tests are implicitly skipped", {
})

test_that("warnings get backtraces", {
  f <- function() {
    warning("def")
  }
  f()
})
