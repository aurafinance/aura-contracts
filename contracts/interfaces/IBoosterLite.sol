// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBoosterLite {
    struct PoolInfo {
        address lptoken;
        address token;
        address gauge;
        address crvRewards;
        address stash;
        bool shutdown;
    }

    function earmarkRewards(uint256 _pid, address _zroPaymentAddress) external payable returns (bool);

    function poolLength() external view returns (uint256);

    function poolInfo(uint256 _pid) external view returns (PoolInfo memory poolInfo);

    function lockIncentive() external view returns (uint256);

    function stakerIncentive() external view returns (uint256);

    function earmarkIncentive() external view returns (uint256);

    function platformFee() external view returns (uint256);

    function FEE_DENOMINATOR() external view returns (uint256);
}
