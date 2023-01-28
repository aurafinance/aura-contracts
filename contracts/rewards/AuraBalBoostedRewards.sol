// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts-0.8/security/ReentrancyGuard.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

import { AuraMath } from "../utils/AuraMath.sol";
import { IRewardStaking } from "../interfaces/IRewardStaking.sol";
import { BalInvestor } from "../core/BalInvestor.sol";
import { IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";
import { IBalancerVault, IAsset } from "../interfaces/balancer/IBalancerCore.sol";

contract AuraBalBoostedRewardPool is ReentrancyGuard, BalInvestor, Ownable {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // Storage
    // ----------------------------------------------------------------

    address public constant AURA = 0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF;
    address public constant BBUSD = 0xA13a9247ea42D743238089903570127DdA72fE44;
    address public constant RETH = 0xae78736Cd615f374D3085123A210448E74Fc6393;

    bytes32 public constant AURABAL_POOL_ID = 0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249;
    bytes32 public constant AURA_ETH_POOL_ID = 0xcfca23ca9ca720b6e98e3eb9b6aa0ffc4a5c08b9000200000000000000000274;
    bytes32 public constant BBUSD_AAVE_POOL_ID = 0xa13a9247ea42d743238089903570127dda72fe4400000000000000000000035d;
    bytes32 private constant BBUSD_RETH_POOL_ID = 0x334c96d792e4b26b841d28f53235281cec1be1f200020000000000000000038a;
    bytes32 private constant RETH_WETH_POOL_ID = 0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112;

    IERC20 public immutable underlying;
    IRewardStaking public immutable auraBalStaking;

    address public harvester;

    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public constant rewardsDuration = 7 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event Harvest(uint256 amount);
    event SetHarvester(address harvester);

    // ----------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    modifier onlyHarvester() {
        require(msg.sender == harvester, "!harvester");
        _;
    }

    // ----------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------

    constructor(
        address _harvester,
        address _underlying,
        address _auraBalStaking,
        // BalInvestor
        IBalancerVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId
    ) public BalInvestor(_balancerVault, _bal, _weth, _balETHPoolId) {
        harvester = _harvester;
        underlying = IERC20(_underlying);
        auraBalStaking = IRewardStaking(_auraBalStaking);
    }

    // ----------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored.add(
                lastTimeRewardApplicable().sub(lastUpdateTime).mul(rewardRate).mul(1e18).div(_totalSupply)
            );
    }

    function earned(address account) public view returns (uint256) {
        return
            _balances[account].mul(rewardPerToken().sub(userRewardPerTokenPaid[account])).div(1e18).add(
                rewards[account]
            );
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate.mul(rewardsDuration);
    }

    // ---------------------------------------------------------
    // Setters
    // ---------------------------------------------------------

    function setHarvester(address _harvester) external onlyOwner {
        harvester = _harvester;
        emit SetHarvester(_harvester);
    }

    function setApprovals() external {
        _setApprovals();

        underlying.safeApprove(address(auraBalStaking), 0);
        underlying.safeApprove(address(auraBalStaking), type(uint256).max);

        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), type(uint256).max);

        IERC20(AURA).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(AURA).safeApprove(address(BALANCER_VAULT), type(uint256).max);

        IERC20(RETH).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(RETH).safeApprove(address(BALANCER_VAULT), type(uint256).max);
    }

    // ----------------------------------------------------------------
    // Mutate
    // ----------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply.add(amount);
        _balances[msg.sender] = _balances[msg.sender].add(amount);
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        _stakeUnderlying();
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _withdrawUnderlying(amount);
        _totalSupply = _totalSupply.sub(amount);
        _balances[msg.sender] = _balances[msg.sender].sub(amount);
        underlying.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        _withdrawUnderlying(reward);
        if (reward > 0) {
            rewards[msg.sender] = 0;
            underlying.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function exit() external {
        withdraw(_balances[msg.sender]);
        getReward();
    }

    // ----------------------------------------------------------------
    // Harvest
    // ----------------------------------------------------------------

    /**
     * @notice Claims rewards and extra rewards from the BaseRewardPool, then it swaps all
     * claimed rewards to cvxCrv.
     * @param _outputBps Multiplier where 100% == 10000, 99.5% == 9950 and 98% == 9800
     */
    function harvest(uint256 _outputBps) external onlyHarvester {
        // TODO: add withdraw function to get extra rewards
        require(auraBalStaking.getReward(address(this), true), "!getReward");

        // 1.1 Swap AURA for WETH
        uint256 auraBalance = IERC20(AURA).balanceOf(address(this));
        if (auraBalance > 0) {
            _swapAuraToWEth(auraBalance);
        }
        // 1.2 Swap bb-a-USD for WETH
        uint256 bbusdBalance = IERC20(BBUSD).balanceOf(address(this));
        if (bbusdBalance > 0) {
            _swapBbAUsdToWEth(bbusdBalance);
        }

        // 1.3 Add BAL/WETH liq to 8020BALWETH
        uint256 bptAmount = _investAllToPool(_outputBps);
        if (bptAmount > 0) {
            // 2. Swap 8020BALWETH-BPT for auraBAL
            // TODO how to calculate uint256 _minAmountOut
            uint256 auraBalAmount = _swapBptToAuraBal(bptAmount, 0);
            // 3. Queue new rewards with the newly swapped auraBAL
            if (auraBalAmount > 0) {
                _notifyRewardAmount(auraBalAmount);
                _stakeUnderlying();
                emit Harvest(auraBalAmount);
            }
        }
    }

    function _swapBptToAuraBal(uint256 _bptAmount, uint256 _minAmountOut) internal returns (uint256) {
        uint256 auraBalBalanceBefore = underlying.balanceOf(address(this));

        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: AURABAL_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(BALANCER_POOL_TOKEN),
            assetOut: IAsset(address(underlying)), // auraBAL
            amount: _bptAmount,
            userData: bytes("")
        });

        BALANCER_VAULT.swap(singleSwap, _createSwapFunds(), _minAmountOut, block.timestamp + 5 minutes);

        uint256 auraBalBalanceAfter = underlying.balanceOf(address(this));
        return auraBalBalanceAfter - auraBalBalanceBefore;
    }

    function _investAllToPool(uint256 _outputBps) internal returns (uint256) {
        uint256 balBalance = IERC20(BAL).balanceOf(address(this));
        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));

        uint256 minOut = _getMinOut(balBalance, wethBalance, _outputBps);
        _joinPool(balBalance, wethBalance, minOut);
        return IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
    }

    /// @notice Swap Aura for WETH on Balancer
    /// @param _amount - amount to swap
    function _swapAuraToWEth(uint256 _amount) internal {
        IBalancerVault.SingleSwap memory _auraSwapParams = IBalancerVault.SingleSwap({
            poolId: AURA_ETH_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(AURA),
            assetOut: IAsset(WETH),
            amount: _amount,
            userData: new bytes(0)
        });

        BALANCER_VAULT.swap(_auraSwapParams, _createSwapFunds(), 0, block.timestamp + 5 minutes);
    }

    /// @notice Swap bb-a-USD for WETH on Balancer via rEth
    /// @param _amount - amount to swap
    function _swapBbAUsdToWEth(uint256 _amount) internal {
        IBalancerVault.BatchSwapStep[] memory _swaps = new IBalancerVault.BatchSwapStep[](2);
        _swaps[0] = IBalancerVault.BatchSwapStep({
            poolId: BBUSD_RETH_POOL_ID,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: _amount,
            userData: new bytes(0)
        });
        _swaps[1] = IBalancerVault.BatchSwapStep({
            poolId: RETH_WETH_POOL_ID,
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: 0,
            userData: new bytes(0)
        });
        IAsset[] memory _zapAssets = new IAsset[](3);
        int256[] memory _limits = new int256[](3);

        _zapAssets[0] = IAsset(BBUSD);
        _zapAssets[1] = IAsset(RETH);
        _zapAssets[2] = IAsset(WETH);

        _limits[0] = int256(_amount);
        _limits[1] = type(int256).max;
        _limits[2] = type(int256).max;

        BALANCER_VAULT.batchSwap(
            IBalancerVault.SwapKind.GIVEN_IN,
            _swaps,
            _zapAssets,
            _createSwapFunds(),
            _limits,
            block.timestamp + 5 minutes
        );
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

    function _notifyRewardAmount(uint256 reward) internal updateReward(address(0)) {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward.div(rewardsDuration);
        } else {
            uint256 remaining = periodFinish.sub(block.timestamp);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = reward.add(leftover).div(rewardsDuration);
        }

        // TODO: add the max reward rate assertion

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp.add(rewardsDuration);
        emit RewardAdded(reward);
    }

    function _withdrawUnderlying(uint256 amount) internal {
        uint256 balance = underlying.balanceOf(address(this));
        if (balance < amount) {
            auraBalStaking.withdraw(amount.sub(balance), false);
        }
    }

    function _stakeUnderlying() internal {
        auraBalStaking.stakeAll();
    }
}
