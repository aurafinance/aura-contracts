// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IVoterProxy {
    /**
     * @notice This function returns the address of the operator.
     * @dev This function is used to get the address of the operator. It is a view function, meaning it does not modify the state of the contract and does not cost any gas.
     */
    function operator() external view returns (address);
}
