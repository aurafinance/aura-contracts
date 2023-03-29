// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @notice A library for performing overflow-/underflow-safe math,
/// updated with awesomeness from of DappHub (https://github.com/dapphub/ds-math).
library AuraMath {
    /**
     * @dev Returns the smallest of two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @notice Adds two uint256 values together and returns the result
     * @dev This function is internal and pure
     * @param a The first uint256 value
     * @param b The second uint256 value
     * @return The result of the addition
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256 c) {
        c = a + b;
    }

    /**
     * @notice Subtracts two uint256 values
     * @dev This function subtracts two uint256 values and returns the result
     * @param a The first uint256 value
     * @param b The second uint256 value
     * @return The result of the subtraction
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256 c) {
        c = a - b;
    }

    /**
     * @notice This function multiplies two uint256 values and returns the result.
     * @dev This function is internal and pure.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256 c) {
        c = a * b;
    }

    /**
     * @notice Divides two uint256 numbers and returns the result
     * @dev This function is used to divide two uint256 numbers and return the result.
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        return a / b;
    }

    /**
     * @dev Returns the average of two numbers. The result is rounded towards
     * zero.
     */
    function average(uint256 a, uint256 b) internal pure returns (uint256) {
        // (a + b) / 2 can overflow, so we distribute.
        return (a / 2) + (b / 2) + (((a % 2) + (b % 2)) / 2);
    }

    /**
     * @notice to224() is a function that takes a uint256 and returns a uint224.
     * @dev This function requires that the uint256 is less than or equal to the maximum value of a uint224. If the uint256 is greater than the maximum value of a uint224, an error is thrown.
     */
    function to224(uint256 a) internal pure returns (uint224 c) {
        require(a <= type(uint224).max, "AuraMath: uint224 Overflow");
        c = uint224(a);
    }

    /**
     * @notice This function is used to convert a uint256 to a uint128.
     * @dev This function requires that the input is less than or equal to the maximum value of a uint128. If the input is greater than the maximum value, an error is thrown. The output is a uint128.
     */
    function to128(uint256 a) internal pure returns (uint128 c) {
        require(a <= type(uint128).max, "AuraMath: uint128 Overflow");
        c = uint128(a);
    }

    /**
     * @notice to112() is an internal function that takes a uint256 and returns a uint112.
     * @dev to112() requires that the input is less than or equal to the maximum value of a uint112, otherwise it will throw an error.
     */
    function to112(uint256 a) internal pure returns (uint112 c) {
        require(a <= type(uint112).max, "AuraMath: uint112 Overflow");
        c = uint112(a);
    }

    /**
     * @notice to96() is a function that takes a uint256 and returns a uint96.
     * @dev This function requires that the uint256 is less than or equal to the maximum value of a uint96. If the uint256 is greater than the maximum value of a uint96, an error will be thrown.
     */
    function to96(uint256 a) internal pure returns (uint96 c) {
        require(a <= type(uint96).max, "AuraMath: uint96 Overflow");
        c = uint96(a);
    }

    /**
     * @notice to32() is a function that takes a uint256 and returns a uint32.
     * @dev This function requires that the input is less than or equal to the maximum value of a uint32. If the input is greater than the maximum value of a uint32, an error will be thrown.
     */
    function to32(uint256 a) internal pure returns (uint32 c) {
        require(a <= type(uint32).max, "AuraMath: uint32 Overflow");
        c = uint32(a);
    }
}

/// @notice A library for performing overflow-/underflow-safe addition and subtraction on uint32.
library AuraMath32 {
    /**
     * @notice Subtracts two uint32 values and returns the result
     * @dev This function subtracts two uint32 values and returns the result.
     * @param a The first uint32 value to subtract
     * @param b The second uint32 value to subtract
     * @return c The result of the subtraction
     */
    function sub(uint32 a, uint32 b) internal pure returns (uint32 c) {
        c = a - b;
    }
}

/// @notice A library for performing overflow-/underflow-safe addition and subtraction on uint112.
library AuraMath112 {
    /**
     * @notice Adds two uint112 values together and returns the result
     * @dev This function should only be used internally
     * @param a The first uint112 value to add
     * @param b The second uint112 value to add
     * @return The result of adding a and b together
     */
    function add(uint112 a, uint112 b) internal pure returns (uint112 c) {
        c = a + b;
    }

    /**
     * @notice Subtracts two uint112 values and returns the result
     * @dev This function subtracts two uint112 values and returns the result
     */
    function sub(uint112 a, uint112 b) internal pure returns (uint112 c) {
        c = a - b;
    }
}

/// @notice A library for performing overflow-/underflow-safe addition and subtraction on uint224.
library AuraMath224 {
    function add(uint224 a, uint224 b) internal pure returns (uint224 c) {
        c = a + b;
    }
}
