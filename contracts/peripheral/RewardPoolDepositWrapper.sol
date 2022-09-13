// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";
import { IRewardPool4626 } from "../interfaces/IRewardPool4626.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   RewardPoolDepositWrapper
 * @notice  Peripheral contract that allows users to deposit into a Balancer pool and then stake their BPT
 *          into Aura in 1 tx. Flow:
 *            - rawToken.transferFrom(user, address(this))
 *            - vault.deposit(rawToken), receive poolToken
 *            - poolToken.approve(rewardPool)
 *            - rewardPool.deposit(poolToken), converts to auraBPT and then deposits
 */
contract RewardPoolDepositWrapper {
    using SafeERC20 for IERC20;

    IBalancerVault public immutable bVault;

    constructor(address _bVault) {
        bVault = IBalancerVault(_bVault);
    }

    /**
     * @dev Deposits a single raw token into a BPT before depositing in reward pool.
     *      Requires sender to approve this contract before calling.
     */
    function depositSingle(
        address _rewardPoolAddress,
        IERC20 _inputToken,
        uint256 _inputAmount,
        bytes32 _balancerPoolId,
        IBalancerVault.JoinPoolRequest memory _request
    ) external {
        // 1. Transfer input token
        _inputToken.safeTransferFrom(msg.sender, address(this), _inputAmount);

        // 2. Deposit to balancer pool
        (address pool, ) = bVault.getPool(_balancerPoolId);

        _inputToken.approve(address(bVault), _inputAmount);
        bVault.joinPool(_balancerPoolId, address(this), address(this), _request);

        uint256 minted = IERC20(pool).balanceOf(address(this));
        require(minted > 0, "!mint");

        uint256 inputBalAfter = _inputToken.balanceOf(address(this));
        if (inputBalAfter != 0) {
            // Refund any amount left in the contract
            _inputToken.transfer(msg.sender, inputBalAfter);
        }

        // 3. Deposit to reward pool
        IERC20(pool).approve(_rewardPoolAddress, minted);
        IRewardPool4626(_rewardPoolAddress).deposit(minted, msg.sender);
    }
}
