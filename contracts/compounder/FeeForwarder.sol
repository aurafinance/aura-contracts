// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

interface IVault {
    function strategy() external view returns (address);
}

interface IStrategy {
    function vault() external view returns (address);
}

/**
 * @title FeeForwarder
 * @dev Forwards collected fees to Vault.
 */
contract FeeForwarder is Ownable {
    using SafeERC20 for IERC20;

    event Forwarded(uint256 amount);

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
    function forward(address vault, address token) public onlyOwner {
        address strategy = IVault(vault).strategy();
        require(strategy != address(0), "!strategy");

        address _vault = IStrategy(strategy).vault();
        require(_vault == vault, "!vault");

        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "!empty");

        IERC20(token).transfer(strategy, bal);
        emit Forwarded(bal);
    }
}
