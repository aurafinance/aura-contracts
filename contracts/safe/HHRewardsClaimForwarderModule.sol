// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";
import { Module } from "./Module.sol";

/**
 * @author  Aura Finance
 * @notice  This module allows a keeper to claim rewards from hidden hands rewards distributor and
 *  forward them to different pools via the stashRewardDistro contract.
 */
contract HHRewardsClaimForwarderModule is Module, KeeperRole, ReentrancyGuard {
    address public immutable cvx;
    address public immutable rewardDistributor;
    address public immutable stashRewardDistro;
    uint256 public constant PERIODS = 2;
    uint256[] public pids;

    /// Same as RewardDistributor.Claim
    struct Claim {
        bytes32 identifier;
        address account;
        uint256 amount;
        bytes32[] merkleProof;
    }
    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event SetPids(uint256[] pids);
    event RewardsClaimed(uint256 cvxClaimed);

    /**
     * @notice  Constructor for the HHRewardsClaimForwarderModule
     * @param _owner        Owner of the contract
     * @param _safeWallet   Address of the Safe
     * @param _cvx       Address of the cvx token
     * @param _stashRewardDistro   Address of the Aura: stashRewardDistro contract
     * @param _rewardDistributor   Address of the HiddenHands rewardDistributor contract
     */
    constructor(
        address _owner,
        address _safeWallet,
        address _cvx,
        address _stashRewardDistro,
        address _rewardDistributor
    ) KeeperRole(_owner) Module(_safeWallet) {
        cvx = _cvx;
        stashRewardDistro = _stashRewardDistro;
        rewardDistributor = _rewardDistributor;
    }

    /**
     * @notice  Call the rewardDistributor.claim call to claim cvx rewards
     */
    function _claimRewards(Claim[] calldata _claims) internal returns (uint256 cvxClaimed) {
        uint256 cvxInitialBalance = IERC20(cvx).balanceOf(address(safeWallet));

        bytes memory data = abi.encodeWithSignature("claim((bytes32,address,uint256,bytes32[])[])", _claims);
        _execCallFromModule(rewardDistributor, data);
        cvxClaimed = IERC20(cvx).balanceOf(address(safeWallet)) - cvxInitialBalance;
    }

    /**
     * @notice  Call the stashRewardDistro.fundPool call to fund a pool
     * @param pid   The Pool id to fund
     */
    function _fundPool(uint256 pid, uint256 amount) internal {
        bytes memory data = abi.encodeWithSignature(
            "fundPool(uint256,address,uint256,uint256)",
            pid,
            cvx,
            amount,
            PERIODS
        );
        _execCallFromModule(stashRewardDistro, data);
    }

    /**
     * @notice  Forward rewards to different pools
     * @param amount   The amount to forward
     */
    function _fundPools(uint256 amount) internal {
        require(pids.length > 0, "No pools to fund");
        _execCallFromModule(cvx, abi.encodeWithSignature("approve(address,uint256)", stashRewardDistro, amount));
        uint256 len = pids.length;
        uint256 amountPerPool = amount / len;
        for (uint256 i = 0; i < pids.length; i++) {
            _fundPool(pids[i], amountPerPool);
        }
    }

    /**
     * @notice  Set the pids to fund
     * @param _pids   The pids to fund
     * @dev Only callable by the owner
     */
    function setPids(uint256[] calldata _pids) external onlyOwner {
        pids = _pids;
        emit SetPids(_pids);
    }

    /**
     * @notice  Claim rewards from hidden hands and forward them to different pools.
     * @param _claims   The claims metadata to claim
     * @return cvxClaimed The amount of cvx claimed and forwarded
     * @dev Only callable by a keeper
     */
    function claimAndForwardRewards(Claim[] calldata _claims)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 cvxClaimed)
    {
        cvxClaimed = _claimRewards(_claims);
        _fundPools(cvxClaimed);
        emit RewardsClaimed(cvxClaimed);
    }
}
