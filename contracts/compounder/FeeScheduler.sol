// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   FeeScheduler
 * @dev     Send fees to the vault
 */
contract FeeScheduler {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant duration = 2 days;
    uint256 public constant nEpochs = 5;

    address public immutable dao;
    address public immutable to;
    address public immutable bal;

    address public immutable vault;
    address public immutable strategy;

    bool public active;
    uint256 public startTime;
    uint256 public startBalance;
    uint256 public forwardedBalance;

    /**
     * @param _dao  The protocol dao
     * @param _to   Who to send fees to (Vault)
     * @param _bal  BAL token contract
     */
    constructor(
        address _dao,
        address _to,
        address _bal
    ) {
        active = false;
        dao = _dao;
        to = _to;
        bal = _bal;

        vault = address(this);
        strategy = address(this);
    }

    /**
     * @dev Initialize the contract
     */
    function init() external {
        require(msg.sender == dao, "!dao");
        require(!active, "active");

        uint256 balance = IERC20(bal).balanceOf(address(this));
        require(balance > 0, "balance<0");

        active = true;
        startTime = block.timestamp;
        startBalance = balance;
    }

    /**
     * @dev Forward fees
     *      Fees are forwarded over nEpochs in equal amounts. If we
     *      are at the final epoch we just send the remaining balance
     */
    function forward() external {
        require(active, "!active");
        uint256 epoch = block.timestamp.sub(startTime).div(duration).add(1);
        uint256 amount = 0;

        if (epoch >= nEpochs) {
            amount = IERC20(bal).balanceOf(address(this));
        } else {
            uint256 totalAmount = startBalance.mul(epoch).div(5);
            amount = totalAmount - forwardedBalance;
        }

        forwardedBalance += amount;
        require(amount > 0, "!amount");

        IERC20(bal).safeTransfer(to, amount);
    }
}
