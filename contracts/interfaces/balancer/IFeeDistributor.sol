// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";

interface IFeeDistributor {
    function claimToken(address user, IERC20 token) external returns (uint256);

    function claimTokens(address user, IERC20[] calldata tokens) external returns (uint256[] memory);

    function getTokenTimeCursor(IERC20 token) external view returns (uint256);

    function checkpointUser(address user) external;

    function getUserTimeCursor(address user) external view returns (uint256);

    function getTimeCursor() external view returns (uint256);

    function depositToken(IERC20 token, uint256 amount) external;

    function getNextNonce(address) external view returns (uint256);

    function setOnlyCallerCheckWithSignature(
        address,
        bool,
        bytes memory
    ) external;
}
