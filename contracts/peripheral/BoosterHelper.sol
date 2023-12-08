// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";

interface IBaseRewardPool {
    function lastTimeRewardApplicable() external view returns (uint256);

    function periodFinish() external view returns (uint256);

    function queuedRewards() external view returns (uint256);

    function extraRewards(uint256) external view returns (address);

    function extraRewardsLength() external view returns (uint256);
}

/**
 * @title   BoosterHelper
 * @author  AuraFinance
 * @notice  Invokes booster.earmarkRewards for multiple pools.
 * @dev     Allows anyone to call `earmarkRewards`  via the booster.
 */
contract BoosterHelper {
    using SafeERC20 for IERC20;
    struct PoolInfo {
        uint256 pid;
        address lptoken;
        address token;
        address gauge;
        address crvRewards;
        address stash;
        bool shutdown;
    }

    IBooster public immutable booster;
    address public immutable crv;

    /**
     * @param _booster      Booster.sol, e.g. 0xF403C135812408BFbE8713b5A23a04b3D48AAE31
     * @param _crv          Crv  e.g. 0xba100000625a3754423978a60c9317c58a424e3D
     */
    constructor(address _booster, address _crv) {
        booster = IBooster(_booster);
        crv = _crv;
    }

    /**
     * @notice Invoke earmarkRewards for each pool id.
     * @param _pids Array of pool ids
     * @return amount of crv received as incentive
     */
    function earmarkRewards(uint256[] memory _pids) external returns (uint256) {
        uint256 len = _pids.length;
        require(len > 0, "!pids");

        for (uint256 i = 0; i < len; i++) {
            require(booster.earmarkRewards(_pids[i]), "!earmark reward");
        }
        // Return all incentives to the sender
        uint256 crvBal = IERC20(crv).balanceOf(address(this));
        IERC20(crv).safeTransfer(msg.sender, crvBal);
        return crvBal;
    }

    /**
     * @notice Invoke processIdleRewards for each pool id.
     * @param _pids Array of pool ids
     */
    function processIdleRewards(uint256[] memory _pids) external {
        uint256 len = _pids.length;
        require(len > 0, "!pids");

        for (uint256 i = 0; i < len; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(_pids[i]);
            IRewardStaking baseRewardPool = IRewardStaking(poolInfo.crvRewards);
            baseRewardPool.processIdleRewards();
        }
    }

    /**
     * @notice Invoke processIdleRewards for each pool address.
     * It is useful to process base pools and virtual pools.
     * @param _pools Array of pool addresses
     */
    function processIdleRewardsByAddress(address[] memory _pools) external {
        uint256 len = _pools.length;
        require(len > 0, "!pools");

        for (uint256 i = 0; i < len; i++) {
            IRewardStaking baseRewardPool = IRewardStaking(_pools[i]);
            baseRewardPool.processIdleRewards();
        }
    }

    // ----------------------------------------------------------------
    // External  Views
    // ----------------------------------------------------------------

    /**
     * @dev Loop through the booster pools and retrieve expired pools.
     * @param start The start pid to look up
     * @param daysToExpiration Number of days before period ends to be considred expired.
     * @return expired poolIds.
     */
    function getExpiredPools(uint256 start, uint256 daysToExpiration) external view returns (PoolInfo[] memory) {
        uint256 end = booster.poolLength();
        PoolInfo[] memory pids = new PoolInfo[](end - start);
        uint256 idx = 0;
        for (uint256 i = start; i < end; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(i);
            if (_isExpiredWithoutQueuedRewards(poolInfo, daysToExpiration)) {
                pids[idx++] = PoolInfo({
                    pid: i,
                    lptoken: poolInfo.lptoken,
                    token: poolInfo.token,
                    gauge: poolInfo.gauge,
                    crvRewards: poolInfo.crvRewards,
                    stash: poolInfo.stash,
                    shutdown: poolInfo.shutdown
                });
            }
        }
        return _sliceArray(pids, idx);
    }

    /**
     * @dev Loop through the booster pools and retrieve the expired pools with idle rewards.
     * @param start The start pid
     * @return idle poolIds.
     */
    function getIdlePoolIds(uint256 start) external view returns (uint256[] memory) {
        uint256 end = booster.poolLength();
        uint256[] memory pids = new uint256[](end - start);
        uint256 idx = 0;
        for (uint256 i = start; i < end; i++) {
            if (_isExpiredWithQueuedRewards(i)) {
                pids[idx++] = i;
            }
        }
        return _sliceArray(pids, idx);
    }

    /**
     * @dev Loop through the booster pools (base and virtual) and retrieve the expired ones with idle rewards.
     * @param start The start pid
     * @return idle pool addresses.
     */
    function getIdleBaseAndVirtualPools(uint256 start) external view returns (address[] memory) {
        uint256 end = booster.poolLength();
        // Create array with extra room for virtual pools
        address[] memory idlePools = new address[]((end - start) * 2);
        uint256 idx = 0;
        for (uint256 i = start; i < end; i++) {
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(i);
            address[] memory virtualRewardPools = _getVirtualRewardPools(poolInfo.crvRewards);
            uint256 virtualRewardPoolsLength = virtualRewardPools.length;
            for (uint256 j = 0; j < virtualRewardPoolsLength; j++) {
                address virtualRewardPool = virtualRewardPools[j];
                if (_isExpiredWithQueuedRewards(virtualRewardPool)) {
                    idlePools[idx++] = virtualRewardPool;
                }
            }
            // Evaluate base reward pools
            if (_isExpiredWithQueuedRewards(poolInfo.crvRewards)) {
                idlePools[idx++] = poolInfo.crvRewards;
            }
        }
        return _sliceArray(idlePools, idx);
    }

    // ----------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------

    /// @dev evaluates if a given pool (by pid) is expired or about to expired if daysToExpiration > 0
    function _isExpiredWithoutQueuedRewards(IBooster.PoolInfo memory poolInfo, uint256 daysToExpiration)
        internal
        view
        returns (bool)
    {
        // Ignore shutdown pools early
        if (poolInfo.shutdown) return false;

        IBaseRewardPool baseRewardPool = IBaseRewardPool(poolInfo.crvRewards);
        if (baseRewardPool.queuedRewards() > 0) return false;

        // If it is expired return the value
        uint256 periodFinish = baseRewardPool.periodFinish();
        if (block.timestamp > periodFinish) return true;

        //If it is not expired yet, evaluate if it is about to expire
        uint256 lastTimeRewardApplicable = baseRewardPool.lastTimeRewardApplicable();
        uint256 daysToNextEarmark = (periodFinish - lastTimeRewardApplicable) / 86400;

        return daysToNextEarmark <= daysToExpiration;
    }

    /// @dev evaluates if a given pool (by pid) is expired with queued rewards.
    function _isExpiredWithQueuedRewards(uint256 pid) internal view returns (bool) {
        IBooster.PoolInfo memory poolInfo = booster.poolInfo(pid);
        // Ignore shutdown pools early
        if (poolInfo.shutdown) return false;

        return _isExpiredWithQueuedRewards(poolInfo.crvRewards);
    }

    /// @dev evaluates if a given pool (by address) is expired with queued rewards.
    function _isExpiredWithQueuedRewards(address crvRewards) internal view returns (bool) {
        IBaseRewardPool baseRewardPool = IBaseRewardPool(crvRewards);
        if (baseRewardPool.queuedRewards() == 0) return false;

        return (block.timestamp > baseRewardPool.periodFinish());
    }

    /// @dev gets all virtual pools linked to a base reward pool.
    function _getVirtualRewardPools(address crvRewards) internal view returns (address[] memory) {
        IBaseRewardPool baseRewardPool = IBaseRewardPool(crvRewards);

        uint256 extraRewardsLength = baseRewardPool.extraRewardsLength();
        address[] memory virtualBalanceRewardPools = new address[](extraRewardsLength);
        for (uint256 i = 0; i < extraRewardsLength; i++) {
            virtualBalanceRewardPools[i] = baseRewardPool.extraRewards(i);
        }
        return virtualBalanceRewardPools;
    }

    function _sliceArray(PoolInfo[] memory _arr, uint256 length) internal pure returns (PoolInfo[] memory) {
        PoolInfo[] memory arr = new PoolInfo[](length);
        for (uint256 i = 0; i < length; i++) {
            arr[i] = _arr[i];
        }
        return arr;
    }

    function _sliceArray(uint256[] memory _arr, uint256 length) internal pure returns (uint256[] memory) {
        uint256[] memory arr = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            arr[i] = _arr[i];
        }
        return arr;
    }

    function _sliceArray(address[] memory _arr, uint256 length) internal pure returns (address[] memory) {
        address[] memory arr = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            arr[i] = _arr[i];
        }
        return arr;
    }
}
