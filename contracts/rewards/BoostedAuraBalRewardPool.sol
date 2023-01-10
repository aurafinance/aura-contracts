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
}

contract BoostedAuraBalRewardPool is GamifiedRewards, BalInvestor {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------
    // Storage
    // ---------------------------------------------------------

    address public cvxCrvStaking;

    address public harvester;

    /// @notice Seconds a user must wait after she initiates her cooldown before withdrawal is possible
    uint256 public constant COOLDOWN_SECONDS = 1814400 seconds;

    /// @notice Window in which it is possible to withdraw, following the cooldown period
    uint256 public constant UNSTAKE_WINDOW = 14 days;

    /// @notice A week
    uint256 private constant ONE_WEEK = 7 days;

    bytes32 public constant AURA_BAL_STABLE_POOL_ID =
        0x3dd0843a028c86e0b760b1a76929d1c5ef93a2dd000200000000000000000249;

    // ---------------------------------------------------------
    // Events
    // ---------------------------------------------------------

    event Harvest(uint256 auraBalAmount);
    event SetHarvester(address harvester);
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

    function setApprovals() external onlyOperator {
        _setApprovals();
        IERC20(BALANCER_POOL_TOKEN).safeApprove(address(BALANCER_VAULT), type(uint256).max);
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
     * to withdraw part or all of their staked tokens. Note, during this period, a users voting power is significantly reduced.
     * If a user already has a cooldown period, then it will reset to the current block timestamp, so use wisely.
     * @param _units Units of stake to cooldown for
     **/
    function startCooldown(uint256 _units) external {
        _startCooldown(_units);
    }

    /**
     * @dev Ends the cooldown of the sender and give them back their full voting power. This can be used to signal that
     * the user no longer wishes to exit the system. Note, the cooldown can also be reset, more smoothly, as part of a stake or
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
        _settleStake(_to, _amount, _exitCooldown);
    }

    /**
     * @dev Internal stake fn.
     * NOTE - Assumes tokens have already been transferred
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

        // 1. If no recollateralisation has occured, the user must be within their UNSTAKE_WINDOW period in order to withdraw
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
        stakingToken.safeTransfer(_recipient, amount);
    }

    /**
     * @dev Enters a cooldown period, after which (and before the unstake window elapses) a user will be able
     * to withdraw part or all of their staked tokens. Note, during this period, a users voting power is significantly reduced.
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

    function harvest(uint256 _outputBps) external onlyHarvester {
        // TODO: swap BAL, AURA and bb-a-USD to auraBAL
        IBaseRewardPool(cvxCrvStaking).getReward(address(this), true);

        // 1. Add BAL as single sided liq to 8020BALWETH
        uint256 bptAmount = _investAllBalToPool(_outputBps);
        if (bptAmount > 0) {
            // 2. Swap 8020BALWETH-BPT for auraBAL
            uint256 auraBalAmount = _swapAllBptForAuraBal(bptAmount);
            // 3. Queue new rewards with the newly swapped auraBAL
            if (auraBalAmount > 0) {
                _queueNewRewards(auraBalAmount);
                emit Harvest(auraBalAmount);
            }
        }
    }

    // ---------------------------------------------------------
    // Internals
    // ---------------------------------------------------------

    function _swapAllBptForAuraBal(uint256 _bptAmount) internal returns (uint256) {
        uint256 auraBalBalanceBefore = IERC20(stakingToken).balanceOf(address(this));

        IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
            poolId: AURA_BAL_STABLE_POOL_ID,
            kind: IBalancerVault.SwapKind.GIVEN_IN,
            assetIn: IAsset(BALANCER_POOL_TOKEN),
            assetOut: IAsset(address(rewardToken)),
            amount: _bptAmount,
            userData: bytes("")
        });

        IBalancerVault.FundManagement memory fundManagement = IBalancerVault.FundManagement({
            sender: address(this),
            fromInternalBalance: false,
            recipient: payable(address(this)),
            toInternalBalance: false
        });

        // TODO: set a proper limit that isn't 0
        BALANCER_VAULT.swap(singleSwap, fundManagement, 0, block.timestamp + 5 minutes);

        uint256 auraBalBalanceAfter = IERC20(stakingToken).balanceOf(address(this));
        return auraBalBalanceAfter - auraBalBalanceBefore;
    }

    function _investAllBalToPool(uint256 _outputBps) internal returns (uint256) {
        uint256 balBalance = IERC20(BAL).balanceOf(address(this));
        uint256 minOut = _getMinOut(balBalance, _outputBps);
        _joinWithBal(balBalance, minOut);
        return IERC20(BALANCER_POOL_TOKEN).balanceOf(address(this));
    }

    // TODO: implement _afterTokenTransfer to track totalSupply
    // TODO: implement abstract functions from AuraBaseRewardPool stake, withdraw etc
}
