// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IRewardHandler {
    function sell() external;

    /**
     * @notice Sets the pending owner of the contract to the given address.
     * @dev The pending owner is the address that will become the owner of the contract if the current owner calls the `claimOwnership` function.
     */
    function setPendingOwner(address _po) external;

    /**
     * @notice This function applies the pending owner of the contract.
     * @dev This function is used to apply the pending owner of the contract. It is called when the current owner is no longer able to manage the contract. The pending owner is set by the current owner using the setPendingOwner() function.
     */
    function applyPendingOwner() external;

    /**
     * @notice This function is used to rescue a token from an address.
     * @dev This function will transfer the token from the address to the specified address.
     */
    function rescueToken(address _token, address _to) external;
}
