// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

import { AuraBaseRewardPool } from "./AuraBaseRewardPool.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";
import { BalInvestor } from "../core/BalInvestor.sol";
import { IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";
import { IBalancerVault, IAsset } from "../interfaces/balancer/IBalancerCore.sol";

contract AuraBalBoostedRewardPool is AuraBaseRewardPool, ReentrancyGuard, BalInvestor, Ownable {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // Storage
    // ----------------------------------------------------------------
    address public immutable AURA;
    bytes32 public immutable AURABAL_POOL_ID;
    IRewardStaking public immutable auraBalStaking;

    address public harvester;

    mapping(address => bytes) public balancerPaths;
    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event Harvest(uint256 amount);
    event SetHarvester(address harvester);
    event SetBalancerPath(address extraRewardToken);

    // ----------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------

    modifier onlyHarvester() {
        require(msg.sender == harvester, "!harvester");
        _;
    }

    // ----------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------

    constructor(
        // AuraBalBoostedRewardPool
        address _harvester,
        address _auraBalStaking,
        address _aura,
        bytes32 _auraBalPoolId,
        // AuraBaseRewardPool
        address _stakingToken,
        address _rewardToken,
        address _rewardManager,
        // BalInvestor
        IBalancerVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId
    )
        public
        BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId)
        AuraBaseRewardPool(_stakingToken, _rewardToken, _rewardManager)
    {
        harvester = _harvester;
        auraBalStaking = IRewardStaking(_auraBalStaking);
        AURA = _aura;
        AURABAL_POOL_ID = _auraBalPoolId;
    }

    // ---------------------------------------------------------
    // Setters
    // ---------------------------------------------------------

    function setHarvester(address _harvester) external onlyOwner {
        harvester = _harvester;
        emit SetHarvester(_harvester);
    }

    function setBalancerPath(address _extraRewardToken, bytes calldata _balancerPath) external onlyOwner {
        _validateBalancerPath(_extraRewardToken, _balancerPath);
        balancerPaths[_extraRewardToken] = _balancerPath;
        emit SetBalancerPath(_extraRewardToken);
    }

    function setApprovals() external {
        _setApprovals();

        stakingToken.safeApprove(address(auraBalStaking), 0);
        stakingToken.safeApprove(address(auraBalStaking), type(uint256).max);

        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), type(uint256).max);

        IERC20(AURA).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(AURA).safeApprove(address(BALANCER_VAULT), type(uint256).max);
    }

    // ----------------------------------------------------------------
    // Harvest
    // ----------------------------------------------------------------

    /**
     * @notice Claims rewards and extra rewards from the BaseRewardPool, then it swaps all
     * claimed rewards to cvxCrv.
     * @param _outputBps Multiplier where 100% == 10000, 99.5% == 9950 and 98% == 9800
     */
    function harvest(uint256 _outputBps, uint256[] memory _minAmountOuts) external onlyHarvester nonReentrant {
        require(auraBalStaking.getReward(address(this), true), "!getReward");

        // 1 Process all extra rewards, swap or queueNewRewards
        _harvestExtraRewards(_minAmountOuts);

        // 2 Add BAL/WETH liq to 8020BALWETH
        uint256 bptAmount = _swapBalTo8020Bpt(_outputBps);
        // 3. Swap 8020BALWETH-BPT for auraBAL
        uint256 auraBalAmount = _swapBptToAuraBal(bptAmount, _minAmountOuts[_minAmountOuts.length - 1]);
        // 4. Queue new rewards with the newly swapped auraBAL
        if (auraBalAmount > 0) {
            _notifyRewardAmount(auraBalAmount);
            _stakeUnderlying();
            emit Harvest(auraBalAmount);
        }
    }

    // ---------------------------------------------------------
    // Internals
    // ---------------------------------------------------------

    function _validateBalancerPath(address _extraRewardToken, bytes memory _balancerPath) internal {
        if (_balancerPath.length > 0) {
            (bytes32[] memory poolId, address[] memory assetIn) = abi.decode(_balancerPath, (bytes32[], address[]));
            uint256 len = poolId.length;
            require(len > 0 && len == assetIn.length, "!wrong swap path");
            require(_extraRewardToken != AURA, "!extraRewardToken : aura");
            require(
                address(stakingToken) != _extraRewardToken && assetIn[0] == _extraRewardToken,
                "!extraRewardToken : auraBal"
            );
        }
    }

    function _harvestExtraRewards(uint256[] memory _minAmountOuts) internal {
        uint256 len = extraRewards.length;

        for (uint256 i = 0; i < len; i++) {
            address extraReward = extraRewards[i];
            address extraRewardToken = IRewardStaking(extraReward).rewardToken();
            uint256 amount = IERC20(extraRewardToken).balanceOf(address(this));
            bytes memory balancerPath = balancerPaths[extraRewardToken];
            // If it is configured to be swapped
            if (amount > 0) {
                if (balancerPath.length > 0) {
                    _swapTokenToWEth(amount, _minAmountOuts[i], balancerPath);
                } else {
                    IERC20(extraRewardToken).safeTransfer(extraReward, amount);
                    IRewardStaking(extraReward).queueNewRewards(amount);
                }
            }
        }
    }

    function _swapBptToAuraBal(uint256 _bptAmount, uint256 _minAmountOut) internal returns (uint256) {
        uint256 auraBalBalanceBefore = stakingToken.balanceOf(address(this));

        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: AURABAL_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(BALANCER_POOL_TOKEN),
            assetOut: IAsset(address(stakingToken)), // auraBAL
            amount: _bptAmount,
            userData: bytes("")
        });

        BALANCER_VAULT.swap(singleSwap, _createSwapFunds(), _minAmountOut, block.timestamp + 5 minutes);

        uint256 auraBalBalanceAfter = stakingToken.balanceOf(address(this));
        return auraBalBalanceAfter - auraBalBalanceBefore;
    }

    function _swapBalTo8020Bpt(uint256 _outputBps) internal returns (uint256) {
        uint256 balBalance = IERC20(BAL).balanceOf(address(this));
        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));

        uint256 minOut = _getMinOut(balBalance, wethBalance, _outputBps);
        _joinPool(balBalance, wethBalance, minOut);

        return IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
    }

    function _swapTokenToWEth(
        uint256 _amount,
        uint256 _minAmountOut,
        bytes memory balancerPath
    ) internal {
        (bytes32[] memory poolIds, address[] memory assetIns) = abi.decode(balancerPath, (bytes32[], address[]));
        uint256 len = poolIds.length;
        uint256 wethBalBefore = IERC20(WETH).balanceOf(address(this));

        IBalancerVault.BatchSwapStep[] memory _swaps = new IBalancerVault.BatchSwapStep[](len);
        IAsset[] memory _zapAssets = new IAsset[](len + 1);
        int256[] memory _limits = new int256[](len + 1);
        for (uint256 i = 0; i < len; i++) {
            require(address(stakingToken) != assetIns[i], "!assetIn");
            _swaps[i] = IBalancerVault.BatchSwapStep({
                poolId: poolIds[i],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: i == 0 ? _amount : 0,
                userData: new bytes(0)
            });

            _zapAssets[i] = IAsset(assetIns[i]);
            _limits[i] = int256(i == 0 ? _amount : 0);
        }
        // Last asset can only be WETH
        _zapAssets[len] = IAsset(WETH);
        _limits[len] = type(int256).max;

        BALANCER_VAULT.batchSwap(
            IBalancerVault.SwapKind.GIVEN_IN,
            _swaps,
            _zapAssets,
            _createSwapFunds(),
            _limits,
            block.timestamp + 5 minutes
        );
        uint256 wethBalAfter = IERC20(WETH).balanceOf(address(this));
        require(_minAmountOut < (wethBalAfter - wethBalBefore), "!_minAmountOut");
    }

    function _createSwapFunds() internal view returns (IBalancerVault.FundManagement memory) {
        return
            IBalancerVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            });
    }

    // ----------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------

    function _withdrawUnderlying(uint256 amount) internal {
        uint256 balance = stakingToken.balanceOf(address(this));
        if (balance < amount) {
            auraBalStaking.withdraw(amount.sub(balance), false);
        }
    }

    function _stakeUnderlying() internal {
        auraBalStaking.stakeAll();
    }

    function _beforeTransferRewards(address, uint256 amount) internal override {
        _withdrawUnderlying(amount);
    }

    function _beforeTransferWithdraw(address, uint256 amount) internal override {
        _withdrawUnderlying(amount);
    }

    function _afterTransferStake(address, uint256) internal override {
        _stakeUnderlying();
    }
}
