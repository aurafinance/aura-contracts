// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { Module } from "./Module.sol";

/**Ø
 * @author  Aura Finance
 * @notice  This module allows a keeper to claim from chef forwarder.
 */
contract ChefForwarderClaimerModule is Module, KeeperRole {
    /// @notice The cvx token address
    address public immutable cvx;

    /// @notice The chefForwarder addresses
    address public immutable chefForwarder;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event CvxClaimed(uint256 cvxClaimed);

    /**
     * @notice  Constructor for the ChefForwarderClaimerModule
     * @param _owner        Owner of the contract
     * @param _safeWallet   Address of the Safe
     * @param _cvx   The address of the CRV token
     * @param _chefForwarder The address of the chef forwarder
     */
    constructor(
        address _owner,
        address _safeWallet,
        address _cvx,
        address _chefForwarder
    ) KeeperRole(_owner) Module(_safeWallet) {
        cvx = _cvx;
        chefForwarder = _chefForwarder;
    }

    /**
     * @notice  Claim from chef forwarder
     * @return cvxClaimed  The amount of CVX claimed
     */
    function _claimFromChefForwarder() private returns (uint256 cvxClaimed) {
        uint256 cvxInitialBalance = IERC20(cvx).balanceOf(address(safeWallet));
        _execCallFromModule(chefForwarder, abi.encodeWithSignature("claim(address)", cvx));
        cvxClaimed = IERC20(cvx).balanceOf(address(safeWallet)) - cvxInitialBalance;
    }

    /* -------------------------------------------------------------------
       Keeper 
    ------------------------------------------------------------------- */
    /**
     * @notice  Claim from chef forwarder.
     * @dev     Only callable by a keeper
     */
    function claimFromChef() external onlyKeeper returns (uint256 cvxClaimed) {
        cvxClaimed = _claimFromChefForwarder();
        emit CvxClaimed(cvxClaimed);
    }
}
