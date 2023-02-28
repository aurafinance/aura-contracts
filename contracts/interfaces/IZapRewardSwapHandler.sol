// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IZapRewardSwapHandler {
    function owner() external view returns (address);

    function pendingOwner() external view returns (address);

    function balVault() external view returns (address);

    function operators(address) external view returns (bool);

    function tokenApproved(address) external view returns (bool);

    function ignoreApproval(address) external view returns (bool);

    function setPendingOwner(address _pendingOwner) external;

    function rescueToken(address _token, address _to) external;

    function setPoolIds(
        address token0,
        address token1,
        bytes32 _poolId
    ) external;

    function setMultiplePoolIds(
        address[] memory token0,
        address[] memory token1,
        bytes32[] memory _poolIds
    ) external;

    function addPath(address[] memory path) external;

    function addMultiplePaths(address[][] memory pathList) external;

    function toggleIgnoredApproval(address token, bool state) external;

    function toggleOperators(address operator, bool state) external;

    function swapTokens(
        address _token0,
        address _token1,
        uint256 _amountIn,
        uint256 _amountOut
    ) external;

    function getMinOut(
        address _token0,
        address _token1,
        uint256 _amountIn,
        uint256 _bps
    ) external returns (uint256 amountOut, uint256 minAmountOut);

    function getPath(address token0, address token1) external view returns (address[] memory path);

    function getPoolId(address token0, address token1) external view returns (bytes32 poolId);
}
