// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IStrategy } from "../interfaces/IStrategy.sol";

interface IVault {
    function strategy() external view returns (address);
}

/**
 * @title FeeForwarder
 * @author  AuraFinance
 * @notice Forwards collected fees to Vault.
 */
contract FeeForwarder is Ownable {
    using SafeERC20 for IERC20;

    event Forwarded(address vault, address token, uint256 amount);

    /**
     * @param _dao Address of DAO
     */
    constructor(address _dao) Ownable() {
        _transferOwnership(_dao);
    }

    /**
     * @dev Forwards the complete balance of token in this contract to the vault
     *      Performs some simple sanity checks on the vault/strategy
     */
    function forward(
        address vault,
        address token,
        uint256 amount
    ) public onlyOwner {
        address strategy = IVault(vault).strategy();
        require(strategy != address(0), "!strategy");

        address _vault = IStrategy(strategy).vault();
        require(_vault == vault, "!vault");

        IERC20(token).safeTransfer(strategy, amount);
        emit Forwarded(vault, token, amount);
    }
}
