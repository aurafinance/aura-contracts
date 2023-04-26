// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IStrategy } from "../interfaces/IStrategy.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

contract SimpleStrategy is IStrategy {
    using SafeERC20 for IERC20;

    address public immutable AURABAL_TOKEN;

    address public immutable VAULT;

    constructor(address _auraBalToken, address _vault) {
        AURABAL_TOKEN = _auraBalToken;
        VAULT = _vault;
    }

    function harvest() external returns (uint256) {
        // silence is golden
    }

    function harvest(uint256 _minAmountOut) external returns (uint256) {
        // silence is golden
    }

    function setApprovals() external {
        // silence is golden
    }

    function stake(uint256 _amount) external {
        // silence is golden
    }

    function totalUnderlying() external view returns (uint256) {
        return IERC20(AURABAL_TOKEN).balanceOf(address(this));
    }

    function withdraw(uint256 _amount) external {
        require(msg.sender == VAULT, "!vault");
        IERC20(AURABAL_TOKEN).safeTransfer(VAULT, _amount);
    }
}
