// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBooster {
    struct FeeDistro {
        address distro;
        address rewards;
        bool active;
    }

    function feeTokens(address _token) external returns (FeeDistro memory);

    function earmarkFees(address _feeToken) external returns (bool);

    struct PoolInfo {
        address lptoken;
        address token;
        address gauge;
        address crvRewards;
        address stash;
        bool shutdown;
    }

    function earmarkRewards(uint256 _pid) external returns (bool);

    function poolInfo(uint256 _pid) external view returns (PoolInfo memory poolInfo);

    function poolLength() external view returns (uint256);

    function lockRewards() external view returns (address);
}
