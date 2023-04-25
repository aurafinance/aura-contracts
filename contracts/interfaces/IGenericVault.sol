// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IGenericVault {
    function withdraw(
        uint256 _assets,
        address _receiver,
        address _owner
    ) external returns (uint256 _withdrawn);

    function withdrawAll(address _to) external returns (uint256 withdrawn);

    function depositAll(address _to) external returns (uint256 _shares);

    function deposit(uint256 _amount, address _receiver) external returns (uint256 _shares);

    function harvest() external;

    function balanceOfUnderlying(address user) external view returns (uint256 amount);

    function totalUnderlying() external view returns (uint256 total);

    function totalSupply() external view returns (uint256 total);

    function underlying() external view returns (address);

    function strategy() external view returns (address);

    function platform() external view returns (address);

    function setPlatform(address _platform) external;

    function setPlatformFee(uint256 _fee) external;

    function setCallIncentive(uint256 _incentive) external;

    function setWithdrawalPenalty(uint256 _penalty) external;

    function setApprovals() external;

    function callIncentive() external view returns (uint256);

    function withdrawalPenalty() external view returns (uint256);

    function platformFee() external view returns (uint256);

    function balanceOf(address owner) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 value) external returns (bool);

    function transfer(address to, uint256 value) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool);

    function extraRewardsLength() external view returns (uint256);

    function extraRewards(uint256) external view returns (address);
}
