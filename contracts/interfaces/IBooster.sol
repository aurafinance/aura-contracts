// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBooster {
    struct FeeDistro {
        address distro;
        address rewards;
        bool active;
    }

    /**
     * @notice This function is used to return the FeeDistro struct associated with the given token address.
     * @dev This function is used to return the FeeDistro struct associated with the given token address. It is called by other functions to get the FeeDistro struct associated with the given token address.
     */
    function feeTokens(address _token) external returns (FeeDistro memory);

    /**
     * @notice This function allows the owner to earmark fees for a specific token.
     * @dev This function allows the owner to earmark fees for a specific token. It takes in an address of the token to be earmarked as an argument. It returns a boolean value indicating the success of the operation.
     */
    function earmarkFees(address _feeToken) external returns (bool);

    struct PoolInfo {
        address lptoken;
        address token;
        address gauge;
        address crvRewards;
        address stash;
        bool shutdown;
    }

    /**
     * @notice This function is used to earmark rewards for a particular project.
     * @dev This function is used to earmark rewards for a particular project. It takes in a project ID as an argument and returns a boolean value indicating whether the operation was successful or not.
     */
    function earmarkRewards(uint256 _pid) external returns (bool);

    /**
     * @notice This function returns the pool information for a given pool ID.
     * @dev This function is used to retrieve the pool information for a given pool ID. It takes in a uint256 _pid as an argument and returns a PoolInfo memory poolInfo.
     */
    function poolInfo(uint256 _pid) external returns (PoolInfo memory poolInfo);
}
