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
    // Types
    // ----------------------------------------------------------------

    struct SwapPath {
        bool isSet;
        bytes32[] poolIds;
        address[] assetsIn;
    }

    // ----------------------------------------------------------------
    // Storage
    // ----------------------------------------------------------------

    address public immutable AURA;
    bytes32 public immutable AURABAL_POOL_ID;
    IRewardStaking public immutable auraBalStaking;

    address public harvester;

    address[] public harvesterTokens;
    mapping(address => SwapPath) internal _swapPaths;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event Harvest(uint256 amount);
    event SetHarvester(address harvester);
    event AddHarvestToken(address harvestToken);
    event RemoveHarvestToken(address harvestToken);

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
        BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId)
        AuraBaseRewardPool(_stakingToken, _rewardToken, _rewardManager)
    {
        harvester = _harvester;
        auraBalStaking = IRewardStaking(_auraBalStaking);
        AURA = _aura;
        AURABAL_POOL_ID = _auraBalPoolId;
    }

    // ---------------------------------------------------------
    // View
    // ---------------------------------------------------------

    function getSwapPath(address _token) external view returns (SwapPath memory) {
        return _swapPaths[_token];
    }

    // ---------------------------------------------------------
    // Setters
    // ---------------------------------------------------------

    function setHarvester(address _harvester) external onlyOwner {
        harvester = _harvester;
        emit SetHarvester(_harvester);
    }

    function addHarvestToken(
        address _token,
        bytes32[] memory poolIds,
        address[] memory assetsIn
    ) external onlyOwner {
        require(!_swapPaths[_token].isSet, "already set");
        uint256 assetsInLength = assetsIn.length;

        require(assetsInLength > 0, "!poolIds");
        require(poolIds.length == assetsIn.length, "parity");
        require(_token != AURA, "token=AURA");
        require(_token == assetsIn[0], "!swap path");
        require(_token != address(stakingToken), "token=stakingToken");

        for (uint256 i = 0; i < assetsInLength; i++) {
            require(assetsIn[i] != address(stakingToken), "!stakingToken");
        }

        _swapPaths[_token] = SwapPath(true, poolIds, assetsIn);
        harvesterTokens.push(_token);
        emit AddHarvestToken(_token);
    }

    function removeHarvestToken(address _token, uint256 _index) external onlyOwner {
        require(harvesterTokens[_index] == _token, "!token");
        delete _swapPaths[_token];
        harvesterTokens[_index] = harvesterTokens[harvesterTokens.length - 1];
        harvesterTokens.pop();
        emit RemoveHarvestToken(_token);
    }

    function setApprovals() external {
        _setApprovals();

        stakingToken.safeApprove(address(auraBalStaking), 0);
        stakingToken.safeApprove(address(auraBalStaking), type(uint256).max);

        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), type(uint256).max);
    }

    // ----------------------------------------------------------------
    // Harvest
    // ----------------------------------------------------------------

    /**
     * @notice Claims rewards and extra rewards from the BaseRewardPool, then it swaps all
     * claimed rewards to cvxCrv.
     * @param _outputBps Multiplier where 100% == 10000, 99.5% == 9950 and 98% == 9800
     */
    function harvest(
        uint256 _outputBps,
        uint256[] memory _minAmountOuts,
        uint256 _auraBalMinAmountOut
    ) external onlyHarvester nonReentrant {
        require(auraBalStaking.getReward(address(this), true), "!getReward");
        uint256 harvesterTokensLength = harvesterTokens.length;
        require(harvesterTokensLength == _minAmountOuts.length, "parity");

        // Queue extra rewards
        uint256 extraRewardsLength = extraRewards.length;
        for (uint256 i = 0; i < extraRewardsLength; i++) {
            address extraReward = extraRewards[i];
            address extraRewardToken = IRewardStaking(extraReward).rewardToken();
            uint256 amount = IERC20(extraRewardToken).balanceOf(address(this));
            if (amount > 0) {
                IERC20(extraRewardToken).safeTransfer(extraReward, amount);
                IRewardStaking(extraReward).queueNewRewards(amount);
            }
        }

        // Swap all the extra rewards (bb-a-USD) to WETH
        for (uint256 i = 0; i < harvesterTokensLength; i++) {
            address token = harvesterTokens[i];
            uint256 balance = IERC20(token).balanceOf(address(this));
            if (balance > 0) {
                _swapTokenToWEth(balance, _minAmountOuts[i], _swapPaths[token]);
            }
        }

        // Add BAL/WETH liq to 8020BALWETH
        uint256 bptAmount = _swapBalTo8020Bpt(_outputBps);
        // Swap 8020BALWETH-BPT for auraBAL
        uint256 auraBalAmount = _swapBptToAuraBal(bptAmount, _auraBalMinAmountOut);
        // Queue new rewards with the newly swapped auraBAL
        if (auraBalAmount > 0) {
            _notifyRewardAmount(auraBalAmount);
            _stakeUnderlying();
            emit Harvest(auraBalAmount);
        }
    }

    // ---------------------------------------------------------
    // Internals
    // ---------------------------------------------------------

    function _swapBptToAuraBal(uint256 _bptAmount, uint256 _minAmountOut) internal returns (uint256) {
        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: AURABAL_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(BALANCER_POOL_TOKEN),
            assetOut: IAsset(address(stakingToken)), // auraBAL
            amount: _bptAmount,
            userData: bytes("")
        });

        BALANCER_VAULT.swap(singleSwap, _createSwapFunds(), _minAmountOut, block.timestamp + 5 minutes);

        return stakingToken.balanceOf(address(this));
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
        SwapPath memory swapPath
    ) internal {
        uint256 len = swapPath.poolIds.length;
        uint256 wethBalBefore = IERC20(WETH).balanceOf(address(this));

        IBalancerVault.BatchSwapStep[] memory swaps = new IBalancerVault.BatchSwapStep[](len);
        IAsset[] memory zapAssets = new IAsset[](len + 1);
        int256[] memory limits = new int256[](len + 1);

        for (uint256 i = 0; i < len; i++) {
            swaps[i] = IBalancerVault.BatchSwapStep({
                poolId: swapPath.poolIds[i],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: i == 0 ? _amount : 0,
                userData: new bytes(0)
            });

            zapAssets[i] = IAsset(swapPath.assetsIn[i]);
            limits[i] = int256(i == 0 ? _amount : 0);
        }

        // Last asset can only be WETH
        zapAssets[len] = IAsset(WETH);
        limits[len] = type(int256).max;

        BALANCER_VAULT.batchSwap(
            IBalancerVault.SwapKind.GIVEN_IN,
            swaps,
            zapAssets,
            _createSwapFunds(),
            limits,
            block.timestamp + 5 minutes
        );

        uint256 wethBalAfter = IERC20(WETH).balanceOf(address(this));
        require(_minAmountOut < (wethBalAfter - wethBalBefore), "!minAmountOut");
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
