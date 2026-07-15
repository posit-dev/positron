#' Add or multiply two numbers
#'
#' @param a a number
#' @param b a number
#'
#' @returns `addition()`: the sum of `a` and `b`. `multiplication()`: the product of `a` and `b`.
#' @export
#'
#' @examples
#' addition(1, 2)
#' multiplication(4, 4)
addition <- function(a, b) a + b

#' @rdname addition
#' @export
multiplication <- function(a, b) a * b
