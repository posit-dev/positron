test_that("test_that with a
multi-line description passes", {
  expect_true(TRUE)
})

test_that("test_that with 'single quotes' fails", {
  expect_true(FALSE)
})

test_that("test_that with one ' single quote passes", {
  expect_true(TRUE)
})

test_that("test_that with `backticks` fails", {
  expect_true(FALSE)
})

test_that("test_that with an & ampersand passes", {
  expect_true(TRUE)
})

test_that("test_that with a slash / fails", {
  expect_true(FALSE)
})
