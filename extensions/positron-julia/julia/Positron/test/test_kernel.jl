# ---------------------------------------------------------------------------------------------
# Copyright (C) 2025 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# ---------------------------------------------------------------------------------------------

"""
Tests for kernel functionality including code completeness checking.
"""

using Test
using Positron

@testset "check_code_complete" begin
    @testset "Complete code" begin
        # Single expression
        @test Positron.check_code_complete("x = 1") == "complete"
        @test Positron.check_code_complete("1 + 1") == "complete"
        @test Positron.check_code_complete("println(\"hello\")") == "complete"

        # Multi-line single expression (function)
        @test Positron.check_code_complete("""
function foo()
    println("hello")
end
""") == "complete"

        # Multi-line single expression (struct)
        @test Positron.check_code_complete("""
struct Point
    x::Float64
    y::Float64
end
""") == "complete"

        # Multi-line single expression (for loop)
        @test Positron.check_code_complete("""
for i in 1:10
    println(i)
end
""") == "complete"

        # Multiple expressions (this is the key fix)
        @test Positron.check_code_complete("""
x = 1
y = 2
""") == "complete"

        @test Positron.check_code_complete("""
x = 1
y = 2
z = x + y
""") == "complete"

        # Multiple expressions including function
        @test Positron.check_code_complete("""
function add(a, b)
    return a + b
end

result = add(1, 2)
""") == "complete"

        # Multiple statements on same line
        @test Positron.check_code_complete("x = 1; y = 2") == "complete"

        # Empty code
        @test Positron.check_code_complete("") == "complete"
        @test Positron.check_code_complete("   ") == "complete"
        @test Positron.check_code_complete("\n\n") == "complete"
    end

    @testset "Incomplete code" begin
        # Incomplete function (missing end)
        @test Positron.check_code_complete("""
function foo()
    println("hello")
""") == "incomplete"

        # Incomplete struct (missing end)
        @test Positron.check_code_complete("""
struct Point
    x::Float64
""") == "incomplete"

        # Incomplete for loop
        @test Positron.check_code_complete("""
for i in 1:10
    println(i)
""") == "incomplete"

        # Incomplete if statement
        @test Positron.check_code_complete("""
if x > 0
    println("positive")
""") == "incomplete"

        # Incomplete assignment
        @test Positron.check_code_complete("x = ") == "incomplete"

        # Incomplete string
        @test Positron.check_code_complete("\"hello") == "incomplete"

        # Incomplete multi-line string
        @test Positron.check_code_complete("\"\"\"hello") == "incomplete"

        # Open parenthesis
        @test Positron.check_code_complete("println(") == "incomplete"

        # Open bracket
        @test Positron.check_code_complete("[1, 2, ") == "incomplete"
    end

    @testset "Invalid code" begin
        # Note: Many "invalid" cases in Julia are actually reported as incomplete
        # because the parser tries to be lenient. These are the cases that are
        # clearly syntax errors.

        # Invalid function call (type assertion with nothing after)
        # This is actually incomplete in Julia's parser
        @test Positron.check_code_complete("x::") == "incomplete"
    end

    @testset "Edge cases" begin
        # Comments only
        @test Positron.check_code_complete("# this is a comment") == "complete"
        @test Positron.check_code_complete("""
# comment 1
# comment 2
""") == "complete"

        # Code with comments
        @test Positron.check_code_complete("""
x = 1  # assign 1 to x
y = 2  # assign 2 to y
""") == "complete"

        # Docstring followed by function
        @test Positron.check_code_complete("""
\"\"\"
This is a docstring
\"\"\"
function documented()
    return 42
end
""") == "complete"

        # Block with begin/end
        @test Positron.check_code_complete("""
begin
    x = 1
    y = 2
end
""") == "complete"

        # Let block
        @test Positron.check_code_complete("""
let x = 1, y = 2
    x + y
end
""") == "complete"

        # Module definition
        @test Positron.check_code_complete("""
module TestMod
    export foo
    foo() = 1
end
""") == "complete"

        # Macro call
        @test Positron.check_code_complete("@show x") == "complete"

        # Unicode
        @test Positron.check_code_complete("α = 1; β = 2; γ = α + β") == "complete"
    end
end
