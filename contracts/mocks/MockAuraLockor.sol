// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

import { IAuraLocker } from "../Interfaces.sol";

/**
 * @title   AuraBalRewardPool
 * @author  Synthetix -> ConvexFinance -> adapted
 * @dev     Modifications from convex-platform/contracts/contracts/BaseRewardPool.sol:
 *            - Delayed start (tokens transferred then delay is enforced before notification)
 *            - One time duration of 14 days
 *            - Remove child reward contracts
 *            - Penalty on claim at 20%
 */
contract MockAuraLockor {
    using SafeERC20 for IERC20;

    IERC20 public immutable aura;
    IAuraLocker public immutable locker;

    constructor(address _aura, address _locker) {
        aura = IERC20(_aura);
        locker = IAuraLocker(_locker);
    }

    function lock(uint256 _amount) external {
        aura.safeTransferFrom(msg.sender, address(this), _amount);
        aura.safeIncreaseAllowance(address(locker), _amount);
        locker.lock(address(this), _amount);
    }

    function lockFor(address _for, uint256 _amount) external {
        aura.safeTransferFrom(msg.sender, address(this), _amount);
        aura.safeIncreaseAllowance(address(locker), _amount);
        locker.lock(_for, _amount);
    }
}
