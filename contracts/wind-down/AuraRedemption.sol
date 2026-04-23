// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { BaseRedemption } from "./BaseRedemption.sol";

/**
 * @title   AuraRedemption (Contract A)
 * @notice  Stage 0 wind-down entry. AURA holders burn AURA in exchange for a
 *          1:1 rAURA receipt and a pro-rata share of a treasury basket.
 *          Pro-rata denominator is the immutable `REDEEMABLE_AURA_SUPPLY`
 *          (total AURA supply minus protocol-owned / ineligible AURA).
 */
contract AuraRedemption is ERC20, BaseRedemption {
    IERC20 public immutable aura;
    uint256 public immutable REDEEMABLE_AURA_SUPPLY;
    uint256 public immutable expiry;

    constructor(
        string memory _name,
        string memory _symbol,
        address _aura,
        uint256 _redeemableAuraSupply,
        uint256 _expiry,
        address _owner
    ) ERC20(_name, _symbol) BaseRedemption(_owner) {
        require(_aura != address(0), "!aura");
        require(_redeemableAuraSupply > 0, "!supply");
        require(_expiry > block.timestamp, "!expiry");

        aura = IERC20(_aura);
        REDEEMABLE_AURA_SUPPLY = _redeemableAuraSupply;
        expiry = _expiry;
    }

    function _burnable() internal view override returns (IERC20) {
        return aura;
    }

    function _denominator() internal view override returns (uint256) {
        return REDEEMABLE_AURA_SUPPLY;
    }

    function _onBeforeFinalize() internal view override {
        require(block.timestamp < expiry, "expired");
    }

    function _onBeforeRedeem(uint256) internal view override {
        require(block.timestamp < expiry, "expired");
    }

    function _onAfterRedeem(address user, uint256 amount) internal override {
        _mint(user, amount);
    }

    function _requireCanSweep() internal view override {
        require(block.timestamp >= expiry, "!expired");
    }
}
