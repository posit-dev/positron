(call
	function: [
		(identifier) @function
		(namespace_operator
			lhs: (identifier)
			rhs: (identifier) @function
		)
	] (#eq? @function "test_that")
	arguments: (arguments
		(argument
			value: (string) @desc
		)
	)
) @call
