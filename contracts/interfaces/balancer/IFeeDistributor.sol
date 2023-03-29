// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

interface IFeeDistributor {
    /**
     * @notice This function allows a user to claim a token.
     * @dev This function is used to transfer a token from the contract to a user.
     * It takes an address of the user and an IERC20 token as parameters.
     * It returns the amount of the token that was transferred.
     */
    function claimToken(address user, IERC20 token) external returns (uint256);

    /**
     * @notice This function allows users to claim tokens from a list of ERC20 tokens.
     * @dev The function takes in an address and an array of ERC20 tokens. It returns an array of uint256 values representing the amount of tokens claimed.
     */
    function claimTokens(address user, IERC20[] calldata tokens) external returns (uint256[] memory);

    /**
     * @notice This function returns the current time cursor of a given ERC20 token.
     * @dev The function takes an IERC20 token as an argument and returns the current time cursor of the token. The time cursor is used to track the time of the token's last transfer.
     */
    function getTokenTimeCursor(IERC20 token) external view returns (uint256);

    /**
     * @dev Function to checkpoint a user's address
     * @param user The address of the user to be checkpointed
     */
    function checkpointUser(address user) external;

    /**
     * @notice This function returns the time cursor of a user
     * @dev This function is used to get the time cursor of a user. It takes an address as an argument and returns a uint256.
     */
    function getUserTimeCursor(address user) external view returns (uint256);

    /**
     * @notice getTimeCursor() returns the current time cursor
     * @dev This function is used to get the current time cursor. It is an external view function and returns a uint256.
     */
    function getTimeCursor() external view returns (uint256);

    /**
     * @notice This function allows users to deposit tokens to the contract.
     * @dev The depositToken function allows users to deposit tokens to the contract. It takes two parameters, an IERC20 token and an amount of tokens to deposit. The function will then transfer the specified amount of tokens from the user's address to the contract's address.
     */
    function depositToken(IERC20 token, uint256 amount) external;

    /**
     * getNextNonce
     *
     * @dev This function is used to get the next nonce for a given address.
     *
     * @param address The address to get the next nonce for.
     *
     * @return uint256 The next nonce for the given address.
     */
    function getNextNonce(address) external view returns (uint256);

    /**
     * @notice This function sets the onlyCallerCheckWithSignature flag for the given address.
     * @dev This function sets the onlyCallerCheckWithSignature flag for the given address. The flag is set to the boolean value passed in as the second parameter. The third parameter is a signature that must be provided to set the flag.*/
    function setOnlyCallerCheckWithSignature(
        address,
        bool,
        bytes memory
    ) external;
}
