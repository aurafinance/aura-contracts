// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   ExtraRewardStashScheduler
 * @dev     Send rewards to extra reward stash
 */
contract ExtraRewardStashScheduler {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant epochDuration = 7 days;
    address public immutable cvx;

    //  epoch => stash => amount
    mapping(uint256 => mapping(address => uint256)) public epochRewards;

    /**
     * @param _cvx  Cvx token contract
     */
    constructor(address _cvx) {
        cvx = _cvx;
    }

    function _getCurrentEpoch() internal view returns (uint256) {
        return block.timestamp.div(epochDuration);
    }

    function _queueRewards(
        address _stash,
        uint256 _nEpochs,
        uint256 _amount,
        bool force
    ) internal {
        IERC20(cvx).safeTransferFrom(msg.sender, address(this), _amount);

        uint256 rewardAmount = _amount.div(_nEpochs);
        uint256 epoch = _getCurrentEpoch();
        for (uint256 i = 0; i < _nEpochs; i++) {
            require(epochRewards[epoch][_stash] == 0 || force, "already queued");
            epochRewards[epoch][_stash] += rewardAmount;
            epoch++;
        }
    }

    /**
     * @dev Get current epoch
     */
    function getCurrentEpoch() external view returns (uint256) {
        return _getCurrentEpoch();
    }

    /**
     * @dev Queue rewards to a stash, it splits the rewards evenly by the number of epochs provided.
     * It reverts if an epoch already has some queued rewards.
     * @param _stash the extra reward stash to queue the rewards to.
     * @param _nEpochs Number of epochs to split the rewards
     * @param _amount Amount of rewards.
     */

    function queueRewards(
        address _stash,
        uint256 _nEpochs,
        uint256 _amount
    ) external {
        _queueRewards(_stash, _nEpochs, _amount, false);
    }

    /**
     * @dev Queue rewards to a stash, it splits the rewards evenly by the number of epochs provided.
     * @param _stash the extra reward stash to queue the rewards to.
     * @param _nEpochs Number of epochs to split the rewards
     * @param _amount Amount of rewards.
     */
    function forceQueueRewards(
        address _stash,
        uint256 _nEpochs,
        uint256 _amount
    ) external {
        _queueRewards(_stash, _nEpochs, _amount, true);
    }

    function _forwardRewards(address _stash, uint256 _epoch) internal {
        require(_epoch <= _getCurrentEpoch(), "!epoch");
        uint256 amount = epochRewards[_epoch][_stash];
        require(amount > 0, "!amount");
        epochRewards[_epoch][_stash] = 0;

        IERC20(cvx).safeTransfer(_stash, amount);
    }

    /**
     * @dev Forward rewards available at current epoch
     * @param _stash the stash to forward its queued rewards
     */
    function forwardRewards(address _stash) external {
        uint256 epoch = _getCurrentEpoch();
        _forwardRewards(_stash, epoch);
    }

    /**
     * @dev Forward rewards available
     * @param _stash the stash to forward its queued rewards
     * @param _epoch the epoch in which the rewards were queded
     */
    function forwardEpochRewards(address _stash, uint256 _epoch) external {
        _forwardRewards(_stash, _epoch);
    }
}
