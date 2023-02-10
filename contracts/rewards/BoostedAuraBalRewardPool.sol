// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Root } from "../utils/Root.sol";
import { Balance } from "./GamifiedStructs.sol";
import { BalInvestor } from "../core/BalInvestor.sol";
import { GamifiedRewards } from "./GamifiedRewards.sol";
import { IBalancerVault } from "../interfaces/balancer/IBalancerCore.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IBalancerVault, IAsset } from "../interfaces/balancer/IBalancerCore.sol";

interface IBaseRewardPool {
    function getReward(address _account, bool _claimExtras) external returns (bool);

    function stake(uint256 amount) external returns (bool);

    function rewardToken() external returns (address);

    function extraRewards(uint256) external returns (address);

    function extraRewardsLength() external view returns (uint256);
}

contract BoostedAuraBalRewardPool is GamifiedRewards, BalInvestor {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------
    // Storage
    // ---------------------------------------------------------

    address public immutable cvxCrvStaking;

    address public harvester;

    mapping(address => bytes) public balancerPaths;

    /// @notice Seconds a user must wait after she initiates her cooldown before withdrawal is possible
    uint256 public constant COOLDOWN_SECONDS = 1814400 seconds;

    /// @notice Window in which it is possible to withdraw, following the cooldown period
    uint256 public constant UNSTAKE_WINDOW = 14 days;

    /// @notice A week
    uint256 private constant ONE_WEEK = 7 days;

    address public constant AURA = 0xC0c293ce456fF0ED870ADd98a0828Dd4d2903DBF;
    bytes32 public constant AURA_BAL_STABLE_POOL_ID =
        0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249;
    bytes32 public constant AURA_ETH_POOL_ID = 0xcfca23ca9ca720b6e98e3eb9b6aa0ffc4a5c08b9000200000000000000000274;

    // ---------------------------------------------------------
    // Events
    // ---------------------------------------------------------

    event Harvest(uint256 auraBalAmount);
    event SetHarvester(address harvester);
    event SetBalancerPath(address token);
    event CooldownExited(address indexed user);
    event Staked(address indexed user, uint256 amount);
    event Cooldown(address indexed user, uint256 percentage);
    event Withdraw(address indexed user, address indexed to, uint256 amount);

    // ---------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------

    constructor(
        // HeadlessStaking
        address _stakingToken,
        address _rewardToken,
        address _operator,
        address _rewardManager,
        // BalInvestor
        IBalancerVault _balancerVault,
        address _bal,
        address _weth,
        bytes32 _balETHPoolId,
        // BoostedAuraBalRewardPool
        address _cvxCrvStaking
    )
        GamifiedRewards(
            // HeadlessStaking
            _stakingToken,
            _rewardToken,
            _operator,
            _rewardManager,
            // GamifiedRewards
            address(0) // questManager
        )
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

    function setBalancerPath(address token, bytes calldata _balancerPath) external onlyOperator {
        _validateBalancerPath(token, _balancerPath);
        balancerPaths[token] = _balancerPath;
        emit SetBalancerPath(token);
    }

    function setApprovals() external onlyOperator {
        _setApprovals();
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), type(uint256).max);

        IERC20(AURA).safeApprove(address(BALANCER_VAULT), 0);
        IERC20(AURA).safeApprove(address(BALANCER_VAULT), type(uint256).max);

        IERC20(stakingToken).safeApprove(cvxCrvStaking, 0);
        IERC20(stakingToken).safeApprove(cvxCrvStaking, type(uint256).max);
    }

    // ---------------------------------------------------------
    // Stake/Withdraw
    // ---------------------------------------------------------

    function stake(uint256 _amount) public override returns (bool) {
        _transferAndStake(msg.sender, _amount, false);
        return true;
    }

    function stakeAll() external override returns (bool) {
        uint256 amount = IERC20(stakingToken).balanceOf(msg.sender);
        _transferAndStake(msg.sender, amount, false);
        return true;
    }

    function stakeFor(address _for, uint256 _amount) public override returns (bool) {
        _transferAndStake(_for, _amount, false);
        return true;
    }

    function withdraw(uint256 amount, bool claim) public override returns (bool) {
        if (claim) {
            getReward(msg.sender, claim);
        }
        _withdraw(amount, msg.sender, true);
        return true;
    }

    /**
     * @dev Enters a cooldown period, after which (and before the unstake window elapses) a user will be able
     * to withdraw part or all of their staked tokens.
     * Note, during this period, a users voting power is significantly reduced.
     * If a user already has a cooldown period, then it will reset to the current block timestamp, so use wisely.
     * @param _units Units of stake to cooldown for
     **/
    function startCooldown(uint256 _units) external {
        _startCooldown(_units);
    }

    /**
     * @dev Ends the cooldown of the sender and give them back their full voting power. This can be used to signal that
     * the user no longer wishes to exit the system.
     * Note, the cooldown can also be reset, more smoothly, as part of a stake or
     * withdraw transaction.
     **/
    function endCooldown() external {
        require(_balances[msg.sender].cooldownTimestamp != 0, "No cooldown");

        _exitCooldownPeriod(msg.sender);

        emit CooldownExited(msg.sender);
    }

    // ---------------------------------------------------------
    // Stake/Withdraw Internals
    // ---------------------------------------------------------

    /**
     * @dev Transfers an `_amount` of staked tokens from sender to this staking contract
     * before calling `_settleStake`.
     * Can be overridden if the tokens are held elsewhere. eg in the Balancer Pool Gauge.
     */
    function _transferAndStake(
        address _to,
        uint256 _amount,
        bool _exitCooldown
    ) internal virtual {
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        IBaseRewardPool(cvxCrvStaking).stake(_amount);
        _settleStake(_to, _amount, _exitCooldown);
    }

    /**
     * @dev Internal stake fn.
     * Note - Assumes tokens have already been transferred
     * @param _amount Units of stakedToken to stake
     * @param _exitCooldown Bool signalling whether to take this opportunity to end any outstanding cooldown and
     * return the user back to their full voting power
     */
    function _settleStake(
        address _to,
        uint256 _amount,
        bool _exitCooldown
    ) internal {
        require(_amount != 0, "INVALID_ZERO_AMOUNT");

        // 2. Deal with cooldown
        //    If a user is currently in a cooldown period, re-calculate their cooldown timestamp
        Balance memory oldBalance = _balances[_to];
        //    If we have missed the unstake window, or the user has chosen to exit the cooldown,
        //    then reset the timestamp to 0
        bool exitCooldown = _exitCooldown ||
            (oldBalance.cooldownTimestamp > 0 &&
                block.timestamp > (oldBalance.cooldownTimestamp + COOLDOWN_SECONDS + UNSTAKE_WINDOW));
        if (exitCooldown) {
            emit CooldownExited(_to);
        }

        // 3. Settle the stake by depositing the stakedToken and minting voting power
        _mintRaw(_to, _amount, exitCooldown);

        emit Staked(_to, _amount);
    }

    /**
     * @dev Withdraw raw tokens from the system, following an elapsed cooldown period.
     * Note - May be subject to a transfer fee, depending on the users weightedTimestamp
     * @param _amount Units of raw staking token to withdraw. eg MTA or mBPT
     * @param _recipient Address of beneficiary who will receive the raw tokens
     * @param _exitCooldown Should we take this opportunity to exit the cooldown period?
     **/
    function _withdraw(
        uint256 _amount,
        address _recipient,
        bool _exitCooldown
    ) internal {
        require(_amount != 0, "INVALID_ZERO_AMOUNT");

        // 1. If no recollateralisation has occured, the user must be within their
        // UNSTAKE_WINDOW period in order to withdraw
        Balance memory oldBalance = _balances[msg.sender];
        require(block.timestamp > oldBalance.cooldownTimestamp + COOLDOWN_SECONDS, "INSUFFICIENT_COOLDOWN");
        require(
            block.timestamp - (oldBalance.cooldownTimestamp + COOLDOWN_SECONDS) <= UNSTAKE_WINDOW,
            "UNSTAKE_WINDOW_FINISHED"
        );

        // 2. Get current balance
        Balance memory balance = _balances[msg.sender];

        // 3. Apply redemption fee
        //      e.g. (55e18 / 5e18) - 2e18 = 9e18 / 100 = 9e16
        uint256 feeRate = calcRedemptionFeeRate(balance.weightedTimestamp);
        //      fee = amount * feeRate / 1e18
        //      totalAmount = amount + fee
        uint256 totalWithdraw = _amount;
        uint256 userWithdrawal = (totalWithdraw * 1e18) / (1e18 + feeRate);

        //      Check for percentage withdrawal
        uint256 maxWithdrawal = oldBalance.cooldownUnits;
        require(totalWithdraw <= maxWithdrawal, "Exceeds max withdrawal");

        // 4. Exit cooldown if the user has specified, or if they have withdrawn everything
        // Otherwise, update the percentage remaining proportionately
        bool exitCooldown = _exitCooldown || totalWithdraw == maxWithdrawal;

        // 5. Settle the withdrawal by burning the voting tokens
        _burnRaw(msg.sender, totalWithdraw, exitCooldown, false);
        // Log any redemption fee to the rewards contract if MTA or
        // the staking token if mBPT.
        _queueNewRewards(totalWithdraw - userWithdrawal);
        // Finally transfer staked tokens back to recipient
        _withdrawStakedTokens(_recipient, userWithdrawal);

        emit Withdraw(msg.sender, _recipient, _amount);
    }

    /**
     * @dev Transfers an `amount` of staked tokens to the withdraw `recipient`. eg MTA or mBPT.
     * Can be overridden if the tokens are held elsewhere. eg in the Balancer Pool Gauge.
     */
    function _withdrawStakedTokens(address _recipient, uint256 amount) internal virtual {
        // TODO: withdraw from underlying cvxCrvStaking
        stakingToken.safeTransfer(_recipient, amount);
    }

    /**
     * @dev Enters a cooldown period, after which (and before the unstake window elapses) a user will be able
     * to withdraw part or all of their staked tokens.
     * Note, during this period, a users voting power is significantly reduced.
     * If a user already has a cooldown period, then it will reset to the current block timestamp, so use wisely.
     * @param _units Units of stake to cooldown for
     **/
    function _startCooldown(uint256 _units) internal {
        require(balanceOf(msg.sender) != 0, "INVALID_BALANCE_ON_COOLDOWN");

        _enterCooldownPeriod(msg.sender, _units);

        emit Cooldown(msg.sender, _units);
    }

    /**
     * @dev fee = sqrt(300/x)-2.5, where x = weeks since user has staked
     * @param _weightedTimestamp The users weightedTimestamp
     * @return _feeRate where 1% == 1e16
     */
    function calcRedemptionFeeRate(uint32 _weightedTimestamp) public view returns (uint256 _feeRate) {
        uint256 weeksStaked = ((block.timestamp - _weightedTimestamp) * 1e18) / ONE_WEEK;
        if (weeksStaked > 3e18) {
            // e.g. weeks = 1  = sqrt(300e18) = 17320508075
            // e.g. weeks = 10 = sqrt(30e18) =   5477225575
            // e.g. weeks = 26 = sqrt(11.5) =    3391164991
            _feeRate = Root.sqrt(300e36 / weeksStaked) * 1e7;
            // e.g. weeks = 1  = 173e15 - 25e15 = 148e15 or 14.8%
            // e.g. weeks = 10 =  55e15 - 25e15 = 30e15 or 3%
            // e.g. weeks = 26 =  34e15 - 25e15 = 9e15 or 0.9%
            _feeRate = _feeRate < 25e15 ? 0 : _feeRate - 25e15;
        } else {
            _feeRate = 75e15;
        }
    }

    // ---------------------------------------------------------
    // Boosted
    // ---------------------------------------------------------
    /**
     * @notice Claims rewards and extra rewards from the BaseRewardPool, then it swaps all
     * claimed rewards to cvxCrv.
     * @param _outputBps Multiplier where 100% == 10000, 99.5% == 9950 and 98% == 9800
     */
    function harvest(uint256 _outputBps) external onlyHarvester {
        // TODO: restake the auraBAL in cvxCrvStaking in order to earn more rewards
        require(IBaseRewardPool(cvxCrvStaking).getReward(address(this), true), "!getReward");
        // 1.1 Swap AURA for WETH
        uint256 auraBalance = IERC20(AURA).balanceOf(address(this));
        if (auraBalance > 0) {
            _swapAuraToWEth(auraBalance);
        }
        // 1.2 For each extra reward, swap it to WETH
        _swapExtraRewardsToWEth();

        // 1.3 Add BAL/WETH liq to 8020BALWETH
        uint256 bptAmount = _investAllToPool(_outputBps);
        // 2. Swap 8020BALWETH-BPT for auraBAL
        uint256 auraBalAmount = _swapBptToAuraBal(bptAmount);
        // 3. Queue new rewards with the newly swapped auraBAL
        if (auraBalAmount > 0) {
            _queueNewRewards(auraBalAmount);
            emit Harvest(auraBalAmount);
        }
    }

    // ---------------------------------------------------------
    // Internals
    // ---------------------------------------------------------

    function _validateBalancerPath(address _token, bytes memory _balancerPath) internal {
        if (_balancerPath.length > 0) {
            (bytes32[] memory poolId, address[] memory assetIn) = abi.decode(_balancerPath, (bytes32[], address[]));
            uint256 len = poolId.length;
            require(len > 0 && len == assetIn.length, "!wrong swap path");
            require(address(stakingToken) != _token && assetIn[0] == _token, "!token");
        }
    }

    /// @notice Swap Aura for WETH on Balancer
    /// @param _amount - amount of Aura to swap
    function _swapAuraToWEth(uint256 _amount) internal {
        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: AURA_ETH_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(AURA),
            assetOut: IAsset(WETH),
            amount: _amount,
            userData: new bytes(0)
        });

        BALANCER_VAULT.swap(singleSwap, _createSwapFunds(), 0, block.timestamp + 5 minutes);
    }

    function _swapExtraRewardsToWEth() internal {
        uint256 len = IBaseRewardPool(address(this)).extraRewardsLength();

        for (uint256 i = 0; i < len; i++) {
            address extraRewardPool = IBaseRewardPool(address(this)).extraRewards(i);
            address extraRewardToken = IBaseRewardPool(extraRewardPool).rewardToken();
            uint256 extraRewardBal = IERC20(extraRewardToken).balanceOf(address(this));
            bytes memory balancerPath = balancerPaths[extraRewardToken];
            if (extraRewardBal > 0 && balancerPath.length > 0) {
                _swapTokenToWEth(extraRewardToken, extraRewardBal, balancerPath);
            }
        }
    }

    function _swapBptToAuraBal(uint256 _bptAmount) internal returns (uint256) {
        uint256 auraBalBalanceBefore = IERC20(stakingToken).balanceOf(address(this));

        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: AURA_BAL_STABLE_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(BALANCER_POOL_TOKEN),
            assetOut: IAsset(address(rewardToken)),
            amount: _bptAmount,
            userData: bytes("")
        });

        BALANCER_VAULT.swap(singleSwap, _createSwapFunds(), 0, block.timestamp + 5 minutes);

        uint256 auraBalBalanceAfter = IERC20(stakingToken).balanceOf(address(this));
        return auraBalBalanceAfter - auraBalBalanceBefore;
    }

    function _investAllToPool(uint256 _outputBps) internal returns (uint256) {
        uint256 balBalance = IERC20(BAL).balanceOf(address(this));
        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));

        uint256 minOut = _getMinOut(balBalance, wethBalance, _outputBps);
        _joinPool(balBalance, wethBalance, minOut);
        return IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
    }

    function _swapTokenToWEth(
        address extraRewardToken,
        uint256 _amount,
        bytes memory balancerPath
    ) internal {
        (bytes32[] memory poolId, address[] memory assetIn) = abi.decode(balancerPath, (bytes32[], address[]));
        uint256 len = poolId.length;

        IBalancerVault.BatchSwapStep[] memory _swaps = new IBalancerVault.BatchSwapStep[](len);
        IAsset[] memory _zapAssets = new IAsset[](len + 1);
        int256[] memory _limits = new int256[](len + 1);
        for (uint256 i = 0; i < len; i++) {
            require(address(stakingToken) != assetIn[i], "!assetIn");
            _swaps[i] = IBalancerVault.BatchSwapStep({
                poolId: poolId[i],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: i == 0 ? _amount : 0,
                userData: new bytes(0)
            });

            _zapAssets[i] = IAsset(assetIn[i]);
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
    // TODO: implement _afterTokenTransfer to track totalSupply
    // TODO: implement abstract functions from AuraBaseRewardPool stake, withdraw etc
}
