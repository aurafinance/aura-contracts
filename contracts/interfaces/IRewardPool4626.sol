// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IRewardPool4626 {
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares);

    /**
     * @notice This function allows users to deposit assets to the contract and receive shares in return.
     * @dev The deposit function takes two parameters, assets and receiver. The assets parameter is a uint256 representing the amount of assets to be deposited. The receiver parameter is an address representing the address of the receiver of the shares. The function returns a uint256 representing the amount of shares received.
     */
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    function asset() external view returns (address);

    /**
     * @dev Function to view the balance of an account
     * @param account The address of the account to view the balance of
     * @return uint256 The balance of the account
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @notice This function is used to process idle rewards for users.
     * @dev This function is triggered by the smart contract and is used to process idle rewards for users. It is triggered when the contract is idle for a certain amount of time. The rewards are calculated based on the amount of time the contract has been idle.*/
    function processIdleRewards() external;
}
