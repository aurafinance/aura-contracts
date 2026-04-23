// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { BaseRedemption } from "./BaseRedemption.sol";

interface IAuraRedemption {
    function expiry() external view returns (uint256);

    function totalSupply() external view returns (uint256);
}

/**
 * @title   RAuraRedemption (Contract B)
 * @notice  Stage 2 wind-down exit for rAURA holders. rAURA is burned for a
 *          pro-rata share of 10% of BAL + WETH released from the veBAL lock
 *          plus any residual treasury swept from AuraRedemption.
 * @dev     Denominator is snapshotted at `finalize` from `rAura.totalSupply()`.
 *          Since AuraRedemption.expiry must have passed before `finalize`,
 *          no further rAURA can ever be minted, so the snapshot covers the
 *          complete holder set.
 */
contract RAuraRedemption is BaseRedemption {
    IAuraRedemption public immutable auraRedemption;
    uint256 public immutable SWEEP_DELAY;

    uint256 public REDEEMABLE_RAURA_SUPPLY;
    uint256 public sweepAfter;

    constructor(
        address _auraRedemption,
        uint256 _sweepDelay,
        address _owner
    ) BaseRedemption(_owner) {
        require(_auraRedemption != address(0), "!rAura");
        require(_sweepDelay > 0, "!delay");

        auraRedemption = IAuraRedemption(_auraRedemption);
        SWEEP_DELAY = _sweepDelay;
    }

    function _burnable() internal view override returns (IERC20) {
        return IERC20(address(auraRedemption));
    }

    function _denominator() internal view override returns (uint256) {
        return REDEEMABLE_RAURA_SUPPLY;
    }

    function _onBeforeFinalize() internal override {
        require(block.timestamp >= auraRedemption.expiry(), "!expired");
        uint256 supply = auraRedemption.totalSupply();
        require(supply > 0, "!supply");
        REDEEMABLE_RAURA_SUPPLY = supply;
    }

    function _onAfterFinalize() internal override {
        sweepAfter = block.timestamp + SWEEP_DELAY;
    }

    function _requireCanSweep() internal view override {
        require(finalized, "!finalized");
        require(block.timestamp >= sweepAfter, "!sweep");
    }
}
