// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IGenericVault {
    /**
     * @notice This function allows a user to withdraw their shares from the contract.
     * @dev The withdraw function takes two parameters, an address and a uint256. The address is the address of the user withdrawing their shares, and the uint256 is the amount of shares they are withdrawing. The function returns a uint256 representing the amount of shares withdrawn.
     */
    function withdraw(address _to, uint256 _shares) external returns (uint256 withdrawn);

    /**
     * @notice This function allows a user to withdraw all of their funds from the contract.
     * @dev The withdrawAll() function will transfer all of the user's funds from the contract to the address specified in the _to parameter.
     */
    function withdrawAll(address _to) external returns (uint256 withdrawn);

    /**
     * @notice This function allows a user to deposit all of their shares to a specified address.
     * @dev This function will transfer all of the user's shares to the specified address. The user must have a valid balance of shares in order to use this function. The function will return the number of shares that were transferred.
     */
    function depositAll(address _to) external returns (uint256 _shares);

    /**
     * @dev Function to deposit a certain amount of funds to a specified address
     * @param _to address to deposit funds to
     * @param _amount amount of funds to deposit
     * @return _shares amount of shares received
     */
    function deposit(address _to, uint256 _amount) external returns (uint256 _shares);

    /**
     * @notice This function allows users to harvest their crops.
     * @dev This function is called when a user wants to harvest their crops. It will check the current state of the crop and if it is ready to be harvested, it will update the state of the crop and transfer the harvest to the user.
     */
    function harvest() external;

    /**
     * @notice This function returns the amount of underlying tokens held by a given user.
     * @dev This function is used to query the balance of underlying tokens held by a given user.
     * @param user The address of the user to query the balance of underlying tokens for.
     * @return The amount of underlying tokens held by the given user.
     */
    function balanceOfUnderlying(address user) external view returns (uint256 amount);

    /**
     * @notice This function returns the total amount of underlying tokens held by the contract.
     * @dev This function is used to get the total amount of underlying tokens held by the contract.
     * @return uint256 total The total amount of underlying tokens held by the contract.
     */
    function totalUnderlying() external view returns (uint256 total);

    /**
     * @notice This function returns the total supply of a token.
     * @dev This function is used to get the total supply of a token.
     * @return uint256 total The total supply of a token.
     */
    function totalSupply() external view returns (uint256 total);

    /**
     * @notice This function returns the address of the underlying asset.
     * @dev This function is used to retrieve the address of the underlying asset.
     */
    function underlying() external view returns (address);

    /**
     * @notice This function is used to return the address of the strategy.
     * @dev This function is used to return the address of the strategy. It is an external view function, meaning that it does not modify the state of the contract. It is used to get the address of the strategy.*/
    function strategy() external view returns (address);

    /**
     * @notice This function returns the address of the platform.
     * @dev This function is used to get the address of the platform.
     */
    function platform() external view returns (address);

    /**
     * @notice Sets the platform address for the contract
     * @dev This function sets the platform address for the contract. This address is used to interact with the platform.
     * @param _platform The address of the platform
     */
    function setPlatform(address _platform) external;

    /**
     * @notice Sets the platform fee for the contract.
     * @dev This function sets the platform fee for the contract. The platform fee is used to cover the costs of running the platform.
     */
    function setPlatformFee(uint256 _fee) external;

    /**
     * @notice Sets the call incentive for the contract.
     * @dev This function sets the call incentive for the contract. It is used to incentivize users to call the contract.
     * @param _incentive The amount of incentive to be set.
     */
    function setCallIncentive(uint256 _incentive) external;

    /**
     * @notice Sets the withdrawal penalty for the contract.
     * @dev This function sets the withdrawal penalty for the contract. The penalty is a percentage of the amount withdrawn.
     * @param _penalty The penalty percentage to be set.
     */
    function setWithdrawalPenalty(uint256 _penalty) external;

    /**
     * @notice This function sets the approvals for a given address
     * @dev This function sets the approvals for a given address. It is used to set the approvals for a given address. It is important to note that this function should only be used by the owner of the address.*/
    function setApprovals() external;

    /**
     * @notice This function is used to call the incentive function.
     * @dev This function is used to call the incentive function and returns a uint256 value.
     */
    function callIncentive() external view returns (uint256);

    /**
     * @notice This function is used to calculate the withdrawal penalty for a given user.
     * @dev The withdrawal penalty is calculated by multiplying the user's withdrawal amount by the penalty rate.
     */
    function withdrawalPenalty() external view returns (uint256);

    /**
     * @dev platformFee()
     *
     * @return uint256 - The platform fee for a given transaction.
     */
    function platformFee() external view returns (uint256);

    /**
     * @dev Function to get the balance of a given address
     * @param owner The address to get the balance of
     * @return The balance of the given address
     */
    function balanceOf(address owner) external view returns (uint256);

    /**
     * @dev Function to check the amount of tokens that an owner allowed to a spender.
     * @param owner The address of the owner of the tokens.
     * @param spender The address of the spender.
     * @return A uint256 representing the amount of tokens still available for the spender.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 value) external returns (bool);

    function transfer(address to, uint256 value) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);

    /**
     * @dev Returns the length of the extraRewards array.
     * @return uint256 The length of the extraRewards array.
     */
    function extraRewardsLength() external view returns (uint256);

    /**
     * @notice extraRewards() is a function that allows users to receive extra rewards.
     * @dev extraRewards() takes in a uint256 parameter and returns an address. This function is view and external.
     */
    function extraRewards(uint256) external view returns (address);
}
