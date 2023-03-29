// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IStrategy {
    /**
     * @notice This function allows users to harvest their crops.
     * @dev This function is called when a user wants to harvest their crops. It returns the amount of crops harvested.
     */
    function harvest() external returns (uint256 harvested);

    /**
     * @notice This function allows users to harvest their rewards from the contract.
     * @dev The harvest function takes in a minimum amount out as an argument and returns the amount harvested.
     */
    function harvest(uint256 _minAmountOut) external returns (uint256 harvested);

    /**
     * @notice This function returns the total amount of underlying tokens held by the contract.
     * @dev This function is used to get the total amount of underlying tokens held by the contract.
     * @return uint256 total The total amount of underlying tokens held by the contract.
     */
    function totalUnderlying() external view returns (uint256 total);

    /**
     * @dev Function to stake a certain amount of tokens
     * @param _amount The amount of tokens to be staked
     */
    function stake(uint256 _amount) external;

    /**
     * @notice This function allows the user to withdraw a specified amount of tokens from their account.
     * @dev The withdraw function will subtract the specified amount from the user's balance and transfer it to the user's address. The user must have sufficient balance to withdraw the specified amount. If the user does not have sufficient balance, the transaction will fail.*/
    function withdraw(uint256 _amount) external;

    /**
     * @notice This function sets the approvals for a given address.
     * @dev This function sets the approvals for a given address. It is called when the user wants to set the approvals for a given address. It is important to note that this function should only be called by the user who owns the address.*/
    function setApprovals() external;
}
