// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBasicRewards {
    /**
     * @notice This function allows a user to stake a certain amount of tokens for a given address.
     * @dev This function requires the caller to have enough tokens to stake. It also requires the caller to have the appropriate permissions to execute the function. The function will return true if the staking was successful.
     */
    function stakeFor(address, uint256) external returns (bool);

    /**
     * @notice This function allows users to view the balance of a given address.
     * @dev This function is declared as external and view, meaning that it can be called from outside the contract and does not modify the state of the contract.
     * @param address The address to check the balance of.
     * @return uint256 The balance of the given address.
     */
    function balanceOf(address) external view returns (uint256);

    /**
     * @dev Function to get the total supply of a token.
     * @return uint256 The total supply of the token.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @notice This function returns the amount of tokens earned by a given address.
     * @dev This function is used to query the amount of tokens earned by a given address. It takes in an address as an argument and returns a uint256 value.
     */
    function earned(address) external view returns (uint256);

    /**
     * @notice This function allows a user to withdraw all of their funds from the contract.
     * @dev This function is called by a user to withdraw all of their funds from the contract. It takes a boolean parameter which indicates whether the user wants to withdraw all of their funds or not. If the boolean is true, the user will be able to withdraw all of their funds. If the boolean is false, the user will not be able to withdraw any of their funds. The function returns a boolean indicating whether the withdrawal was successful or not.*/
    function withdrawAll(bool) external returns (bool);

    /**
     * @notice This function allows a user to withdraw funds from their account.
     * @dev The function takes two parameters, a uint256 amount and a boolean flag.
     * If the flag is set to true, the amount will be withdrawn from the user's account.
     * If the flag is set to false, the amount will not be withdrawn.
     * The function returns a boolean indicating whether the withdrawal was successful.
     */
    function withdraw(uint256, bool) external returns (bool);

    /**
     * @notice This function allows a user to withdraw funds from their account.
     * @dev This function is called by the user to withdraw funds from their account. It takes in an address and a uint256 as parameters. The address is the address of the user and the uint256 is the amount of funds to be withdrawn. The function then transfers the funds from the user's account to the address provided.*/
    function withdraw(address, uint256) external;

    /**
     * @notice This function allows users to withdraw their funds from the contract and unwrap them.
     * @dev This function allows users to withdraw their funds from the contract and unwrap them. It takes in two parameters, the amount to withdraw and a boolean value to indicate whether the user wants to claim their funds. It returns a boolean value to indicate whether the withdrawal was successful.
     */
    function withdrawAndUnwrap(uint256 amount, bool claim) external returns (bool);

    /**
     * @notice This function is used to get the reward for a user.
     * @dev This function is used to get the reward for a user. It is triggered by an external call and returns a boolean value.
     */
    function getReward() external returns (bool);

    /**
     * @notice This function allows users to stake tokens to the contract.
     * @dev This function takes in a uint256 value and returns a boolean value.
     */
    function stake(uint256) external returns (bool);

    /**
     * @notice This function allows a user to stake a certain amount of tokens.
     * @dev This function is called by a user to stake a certain amount of tokens. It takes in two parameters, an address and a uint256. The address is the address of the user who is staking the tokens and the uint256 is the amount of tokens being staked.
     */
    function stake(address, uint256) external;

    /**
     * @notice extraRewards() is a function that allows users to receive extra rewards.
     * @dev extraRewards() takes in a uint256 parameter and returns an address. This function is view and external.
     */
    function extraRewards(uint256) external view returns (address);

    /**
     * @notice This function is used to exit the contract.
     * @dev This function is used to exit the contract and returns a boolean value.
     */
    function exit() external returns (bool);
}
