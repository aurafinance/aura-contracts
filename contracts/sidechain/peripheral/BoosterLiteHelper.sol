// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBoosterLite } from "../../interfaces/IBoosterLite.sol";
import { IRewardStaking } from "../../interfaces/IRewardStaking.sol";

/**
 * @title   BoosterLiteHelper
 * @author  AuraFinance
 * @notice  Invokes booster.earmarkRewards for multiple pools on BoosterLite
 * @dev     Allows anyone to call `earmarkRewards`  via the booster.
 */
contract BoosterLiteHelper {
    using SafeERC20 for IERC20;

    IBoosterLite public immutable booster;
    address public immutable crv;

    /**
     * @param _booster      Booster.sol
     * @param _crv          Crv  e.g. 0xba100000625a3754423978a60c9317c58a424e3D
     */
    constructor(address _booster, address _crv) {
        booster = IBoosterLite(_booster);
        crv = _crv;
    }

    receive() external payable {}

    /**
     * @notice Invoke earmarkRewards for each pool id.
     * The `msg.value`  must be enough to invoke `_pids.length` times `booster.earmarkRewards`,
     * any gas not used is returned to the caller.
     * @param _pids Array of pool ids
     * @param _zroPaymentAddress The LayerZero ZRO payment address
     */
    function earmarkRewards(uint256[] memory _pids, address _zroPaymentAddress) external payable returns (uint256) {
        uint256 len = _pids.length;
        require(len > 0, "!pids");
        uint256 nativeFee = msg.value / len;
        for (uint256 i = 0; i < len; i++) {
            require(booster.earmarkRewards{ value: nativeFee }(_pids[i], _zroPaymentAddress), "!earmark reward");
        }
        // Return all incentives and left over native fee to the sender
        uint256 crvBal = IERC20(crv).balanceOf(address(this));
        IERC20(crv).safeTransfer(msg.sender, crvBal);

        // (bool sent, ) = payable(msg.sender).call{ value: address(this).balance }("");
        // require(sent, "!refund");

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
            IBoosterLite.PoolInfo memory poolInfo = booster.poolInfo(_pids[i]);
            IRewardStaking baseRewardPool = IRewardStaking(poolInfo.crvRewards);
            baseRewardPool.processIdleRewards();
        }
    }
}
