// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IStashRewardDistro } from "../interfaces/IStashRewardDistro.sol";
import { IVirtualRewards } from "../interfaces/IVirtualRewards.sol";
import { IExtraRewardStash } from "../interfaces/IExtraRewardStash.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { IBooster } from "../interfaces/IBooster.sol";

interface IBoosterOrBoosterLite is IBooster {
    function earmarkRewards(uint256, address) external;
}

/**
 * @title   StashRewardDistro
 * @author  Aura Finance
 */
contract StashRewardDistro is IStashRewardDistro {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    // @dev Epoch duration
    uint256 public constant EPOCH_DURATION = 1 weeks;

    // @dev The booster address
    IBoosterOrBoosterLite public immutable booster;

    // @dev Epoch => Pool ID => Token => Amount
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public getFunds;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event Funded(uint256 epoch, uint256 pid, address token, uint256 amount);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    /**
     * @param _booster The booster
     */
    constructor(address _booster) {
        booster = IBoosterOrBoosterLite(_booster);
    }

    /* -------------------------------------------------------------------
       View 
    ------------------------------------------------------------------- */

    /**
     * @dev Get the current epoch
     */
    function getCurrentEpoch() external view returns (uint256) {
        return _getCurrentEpoch();
    }

    /* -------------------------------------------------------------------
       Core
    ------------------------------------------------------------------- */

    /**
     * @dev  Fund a pool for the next epoch. Epochs are 1 week in length and run
     *       Thursday to Thursday
     * @param _pid Pool ID
     * @param _token Token address
     * @param _amount Amount of the token to fund in total
     * @param _periods Number of periods to fund
     *                 _amount is split evenly between the number of periods
     */
    function fundPool(
        uint256 _pid,
        address _token,
        uint256 _amount,
        uint256 _periods
    ) external {
        // Keep 1 wei of the reward token for each period to faciliate
        // processing idle rewards if needed
        uint256 rewardAmount = _amount - _periods;

        // Loop through n periods and assign rewards to each epoch
        // Add 1 to the epoch so it can only be queued for the next epoch which
        // will be the next thursday. The process will be
        // fundPool is called on tuesday and adds rewards to the next epoch which
        // will start on thursday
        uint256 epoch = _getCurrentEpoch().add(1);
        uint256 epochAmount = rewardAmount.div(_periods);
        for (uint256 i = 0; i < _periods; i++) {
            getFunds[epoch][_pid][_token] = getFunds[epoch][_pid][_token].add(epochAmount);
            emit Funded(epoch, _pid, _token, epochAmount);
            epoch++;
        }

        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
    }

    /**
     * @notice Queue the current epoch's rewards to the pid's stash and calls earmark rewards
     * @param _pid  The pool id to queue rewards.
     * @param _token The reward token.
     */
    function queueRewards(uint256 _pid, address _token) external {
        _queueRewards(_getCurrentEpoch(), _pid, _token);
    }

    /**
     * @notice Queue rewards to the pid's stash and calls earmark rewards
     *  It can only queue past or current epoch's rewards
     * @param _pid  The pool id to queue rewards.
     * @param _token The reward token.
     * @param _epoch The epoch to process.
     */
    function queueRewards(
        uint256 _pid,
        address _token,
        uint256 _epoch
    ) external {
        require(_epoch <= _getCurrentEpoch(), "!epoch");
        _queueRewards(_epoch, _pid, _token);
    }

    /**
     * @notice Processes queued rewards in isolation, providing the period has finished.
     *      It sends 1 wei to the stash and call earmark rewards on the booster
     * @param _pid  The pool id to process idle rewards.
     * @param _token The reward token.
     */
    function processIdleRewards(uint256 _pid, address _token) external {
        // Get the stash and the extra rewards contract
        IBoosterOrBoosterLite.PoolInfo memory poolInfo = booster.poolInfo(_pid);
        IExtraRewardStash stash = IExtraRewardStash(poolInfo.stash);
        (, address rewards, ) = stash.tokenInfo(_token);

        // Check that the period finish has passed and there are queued
        // rewards that need processing
        uint256 periodFinish = IVirtualRewards(rewards).periodFinish();
        uint256 queuedRewards = IVirtualRewards(rewards).queuedRewards();
        require(block.timestamp > periodFinish, "!periodFinish");
        require(queuedRewards != 0, "!queueRewards");

        // Transfer 1 wei to the stash and call earmark to force a new
        // queue of rewards to start
        IERC20(_token).safeTransfer(address(stash), 1);
        _earmarkRewards(_pid);
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */

    function _queueRewards(
        uint256 _epoch,
        uint256 _pid,
        address _token
    ) internal {
        uint256 amount = getFunds[_epoch][_pid][_token];
        require(amount != 0, "!amount");
        getFunds[_epoch][_pid][_token] = 0;

        IBoosterOrBoosterLite.PoolInfo memory poolInfo = booster.poolInfo(_pid);
        IERC20(_token).safeTransfer(poolInfo.stash, amount);
        _earmarkRewards(_pid);
    }

    function _getCurrentEpoch() internal view returns (uint256) {
        return block.timestamp.div(EPOCH_DURATION);
    }

    function _earmarkRewards(uint256 pid) internal virtual {
        booster.earmarkRewards(pid);
    }
}
