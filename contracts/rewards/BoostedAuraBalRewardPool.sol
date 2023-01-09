// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { BalInvestor } from "../core/BalInvestor.sol";
import { AuraBaseRewardPool } from "./AuraBaseRewardPool.sol";
import { IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";

interface IBaseRewardPool {
    function getReward(address _account, bool _claimExtras) external returns (bool);
}

contract BoostedAuraBalRewardPool is AuraBaseRewardPool, BalInvestor {

    // ---------------------------------------------------------
    // Storage 
    // ---------------------------------------------------------

    address public cvxCrvStaking;

    // ---------------------------------------------------------
    // Events
    // ---------------------------------------------------------

    event SetHarvester(address harvester);

    event Harvest(uint256 auraBalAmount);

    // ---------------------------------------------------------
    // Constructor 
    // ---------------------------------------------------------

    constructor(
        uint256 _pid,
        address _stakingToken,
        address _rewardToken,
        address _operator,
        address _rewardManager,
        // BalInvestor params
        IBalancerVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId
        // GamifiedRewardPool params
        address _cvxCrvStaking,
    )
        AuraBaseRewardPool(_pid, _stakingToken, _rewardToken, _operator, _rewardManager)
        BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId)
    {
        cvxCrvStaking = _cvxCrvStaking;
        harvester = msg.sender;
    }

    // ---------------------------------------------------------
    // Modifiers 
    // ---------------------------------------------------------

    modifier onlyHarvester() {
        require(msg.sender == harvester, "!harvester");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "!operator");
        _;
    }

    // ---------------------------------------------------------
    // Setters 
    // ---------------------------------------------------------

    function setHarvester(address _harvester) external onlyOperator {
        harvester = _harvester;
        emit SetHarvester(_harvester);
    }

    // ---------------------------------------------------------
    // Core 
    // ---------------------------------------------------------

    function harvest(uint256 _outputBps) external onlyHarvester {
        // TODO: swap BAL, AURA and bb-a-USD to auraBAL
        IBaseRewardPool(cvxCrvStaking).getReward(address(this), true);

        // 1. Add BAL as single sided liq to 8020BALWETH
        uint256 bptAmount = _investAllBalToPool();
        // 2. Swap 8020BALWETH-BPT for auraBAL
        uint256 auraBalAmount = _swapAllBptForAuraBal(bptAmount);
        // 3. Queue new rewards with the newly swapped auraBAL
        if(auraBalAmount > 0) {
            _queueNewRewards(auraBalAmount);
        }

        emit Harvest(auraBalAmount);
    }

    // ---------------------------------------------------------
    // Internals 
    // ---------------------------------------------------------

    function _swapBptForAuraBal(uint256 _bptAmount) internal returns (uint256) {
        uint256 auraBalBalanceBefore = IERC20(cvxCrv).balanceOf(address(this));
        // TODO: swap BPT for auraBAL
        uint256 auraBalBalanceAfter = IERC20(cvxCrv).balanceOf(address(this));
        return auraBalBalanceAfter - auraBalBalanceBefore;
    }

    function _investAllBalToPool() internal returns (uint256) {
        uint256 balBalance = IERC20(BAL).balanceOf(address(this));
        uint256 minOut = _getMinOut(balBalance, _outputBps);
        _investBalToPool(balance, minOut);
        return IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
    }

    // TODO: implement _afterTokenTransfer to track totalSupply
    // TODO: implement abstract functions from AuraBaseRewardPool stake, withdraw etc
}
