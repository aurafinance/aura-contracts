// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBasicRewards {
    function stakeFor(address, uint256) external returns (bool);

    function balanceOf(address) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function earned(address) external view returns (uint256);

    function withdrawAll(bool) external returns (bool);

    function withdraw(uint256, bool) external returns (bool);

    function withdraw(address, uint256) external;

    function withdrawAndUnwrap(uint256 amount, bool claim) external returns (bool);

    function getReward() external returns (bool);

    function stake(uint256) external returns (bool);

    function stake(address, uint256) external;

    function extraRewards(uint256) external view returns (address);

    function exit() external returns (bool);
}
