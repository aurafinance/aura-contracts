// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IBooster {
<<<<<<< HEAD
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

    function poolInfo(uint256 _pid) external returns (PoolInfo memory poolInfo);
=======
    function earmarkRewards(uint256 _pid) external returns (bool);

    function deposit(
        uint256 _pid,
        uint256 _amount,
        bool _stake
    ) external returns (bool);

    function withdraw(uint256 _pid, uint256 _amount) external returns (bool);

    function poolInfo(uint256)
        external
        view
        returns (
            address,
            address,
            address,
            address,
            address,
            bool
        );

    function lockIncentive() external view returns (uint256);

    function stakerIncentive() external view returns (uint256);

    function earmarkIncentive() external view returns (uint256);

    function platformFee() external view returns (uint256);

    function FEE_DENOMINATOR() external view returns (uint256);
>>>>>>> ed76911 (feat: move interfaces to seperate files)
}
