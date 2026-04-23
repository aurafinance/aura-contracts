// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { BaseRedemption } from "./BaseRedemption.sol";

/**
 * @title   AuraBalRedemption (Contract C)
 * @notice  Stage 2 terminal exit for auraBAL holders. auraBAL is burned for
 *          a pro-rata share of 90% of BAL + WETH released from the veBAL lock.
 *          No receipt token is minted.
 * @dev     Denominator is snapshotted at `finalize` from `auraBal.totalSupply()`.
 *          Protocol-owned auraBAL must be burned or moved before `finalize`
 *          so it does not consume a slice.
 */
contract AuraBalRedemption is BaseRedemption {
    IERC20 public immutable auraBal;
    uint256 public immutable SWEEP_DELAY;

    uint256 public REDEEMABLE_AURABAL_SUPPLY;
    uint256 public sweepAfter;

    constructor(
        address _auraBal,
        uint256 _sweepDelay,
        address _owner
    ) BaseRedemption(_owner) {
        require(_auraBal != address(0), "!auraBal");
        require(_sweepDelay > 0, "!delay");

        auraBal = IERC20(_auraBal);
        SWEEP_DELAY = _sweepDelay;
    }

    function _burnable() internal view override returns (IERC20) {
        return auraBal;
    }

    function _denominator() internal view override returns (uint256) {
        return REDEEMABLE_AURABAL_SUPPLY;
    }

    function _onBeforeFinalize() internal override {
        uint256 supply = auraBal.totalSupply();
        require(supply > 0, "!supply");
        REDEEMABLE_AURABAL_SUPPLY = supply;
    }

    function _onAfterFinalize() internal override {
        sweepAfter = block.timestamp + SWEEP_DELAY;
    }

    function _requireCanSweep() internal view override {
        require(finalized, "!finalized");
        require(block.timestamp >= sweepAfter, "!sweep");
    }
}
