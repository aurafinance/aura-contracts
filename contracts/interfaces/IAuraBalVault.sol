// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IAuraBalVault {
    function underlying() external view returns (address);

    function withdrawalPenalty() external view returns (uint256);

    function extraRewards(uint256 index) external view returns (address);

    function extraRewardsLength() external view returns (uint256);

    function totalUnderlying() external view returns (uint256);

    function balanceOf(address user) external view returns (uint256);

    function balanceOfUnderlying(address user) external view returns (uint256);

    function totalSupply() external view returns (uint256);
}
