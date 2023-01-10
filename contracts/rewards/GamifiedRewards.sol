// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./GamifiedStructs.sol";
import { AuraMath } from "../utils/AuraMath.sol";
import { AuraHeadlessRewardPool } from "./AuraHeadlessRewardPool.sol";

// TODO:
interface IQuestManager {  
    function checkForSeasonFinish(address _account) external returns (uint8 newQuestMultiplier);
}

/**
 * @title GamifiedRewards
 **/
abstract contract GamifiedRewards is AuraHeadlessRewardPool {
    /// @notice Total token supply
    uint256 internal _totalSupply;
    /// @notice User balance structs containing all data needed to scale balance
    mapping(address => Balance) internal _balances;
    /// @notice Quest Manager
    IQuestManager public immutable questManager;

    // ---------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------

    /**
     * @param _questManager Manager of quests
     */
    constructor(
        // HeadlessStaking
        uint256 _pid,
        address _stakingToken,
        address _rewardToken,
        address _operator,
        address _rewardManager,
        // GamifiedRewards
        address _questManager
    ) 
        AuraHeadlessRewardPool(
            _pid,
            _stakingToken,
            _rewardToken,
            _operator,
            _rewardManager
        )
    {
        questManager = IQuestManager(_questManager);
    }

    /**
     * @dev Checks that _msgSender is the quest Manager
     */
    modifier onlyQuestManager() {
        require(msg.sender == address(questManager), "!questManager");
        _;
    }

    // ---------------------------------------------------------
    // Views
    // ---------------------------------------------------------

    /**
     * @dev Simply gets scaled balance
     * @return scaled balance for user
     */
    function balanceOf(address _account)
        public
        view
        virtual
        override(AuraHeadlessRewardPool)
        returns (uint256)
    {
        return _getBalance(_account, _balances[_account]);
    }

    /**
     * @dev Simply gets raw balance
     * @return raw balance for user
     */
    function rawBalanceOf(address _account) public view returns (uint256, uint256) {
        return (_balances[_account].raw, _balances[_account].cooldownUnits);
    }

    /**
     * @dev Scales the balance of a given user by applying multipliers
     */
    function _getBalance(address _account, Balance memory _balance)
        internal
        view
        returns (uint256 balance)
    {
        // e.g. raw = 1000, questMultiplier = 40, timeMultiplier = 30. Cooldown of 60%
        // e.g. 1000 * (100 + 40) / 100 = 1400
        balance = (_balance.raw * (100 + _balance.questMultiplier)) / 100;
        // e.g. 1400 * (100 + 30) / 100 = 1820
        balance = (balance * (100 + _balance.timeMultiplier)) / 100;
    }

    /**
     * @notice Raw staked balance without any multipliers
     */
    function balanceData(address _account) external view returns (Balance memory) {
        return _balances[_account];
    }


    function totalSupply() public view override(AuraHeadlessRewardPool) returns (uint256) {
        return _totalSupply;
    }

    // ---------------------------------------------------------
    // Quests
    // ---------------------------------------------------------

    /**
     * @dev Called by anyone to poke the timestamp of a given account. This allows users to
     * effectively 'claim' any new timeMultiplier, but will revert if there is no change there.
     */
    function reviewTimestamp(address _account) external {
        _reviewWeightedTimestamp(_account);
    }

    /**
     * @dev Adds the multiplier awarded from quest completion to a users data, taking the opportunity
     * to check time multipliers etc.
     * @param _account Address of user that should be updated
     * @param _newMultiplier New Quest Multiplier
     */
    function applyQuestMultiplier(address _account, uint8 _newMultiplier)
        external
        onlyQuestManager
    {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance & update questMultiplier, only if user has a balance
        Balance memory oldBalance = _balances[_account];
        uint256 oldScaledBalance = _getBalance(_account, oldBalance);
        if (oldScaledBalance > 0) {
            _applyQuestMultiplier(_account, oldBalance, oldScaledBalance, _newMultiplier);
        }
    }

    /**
     * @dev Gets the multiplier awarded for a given weightedTimestamp
     * @param _ts WeightedTimestamp of a user
     * @return timeMultiplier Ranging from 20 (0.2x) to 60 (0.6x)
     */
    function _timeMultiplier(uint32 _ts) internal view returns (uint8 timeMultiplier) {
        // If the user has no ts yet, they are not in the system
        if (_ts == 0) return 0;

        uint256 hodlLength = block.timestamp - _ts;
        if (hodlLength < 13 weeks) {
            // 0-3 months = 1x
            return 0;
        } else if (hodlLength < 26 weeks) {
            // 3 months = 1.2x
            return 20;
        } else if (hodlLength < 52 weeks) {
            // 6 months = 1.3x
            return 30;
        } else if (hodlLength < 78 weeks) {
            // 12 months = 1.4x
            return 40;
        } else if (hodlLength < 104 weeks) {
            // 18 months = 1.5x
            return 50;
        } else {
            // > 24 months = 1.6x
            return 60;
        }
    }

    // ---------------------------------------------------------
    // Balance changes
    // ---------------------------------------------------------

    /**
     * @dev Adds the multiplier awarded from quest completion to a users data, taking the opportunity
     * to check time multiplier.
     * @param _account Address of user that should be updated
     * @param _newMultiplier New Quest Multiplier
     */
    function _applyQuestMultiplier(
        address _account,
        Balance memory _oldBalance,
        uint256 _oldScaledBalance,
        uint8 _newMultiplier
    ) private updateReward(_account) {
        // 1. Set the questMultiplier
        _balances[_account].questMultiplier = _newMultiplier;

        // 2. Take the opportunity to set weighted timestamp, if it changes
        _balances[_account].timeMultiplier = _timeMultiplier(_oldBalance.weightedTimestamp);

        // 3. Update scaled balance
        _settleScaledBalance(_account, _oldScaledBalance);
    }

    /**
     * @dev Entering a cooldown period means a user wishes to withdraw. With this in mind, their balance
     * should be reduced until they have shown more commitment to the system
     * @param _account Address of user that should be cooled
     * @param _units Units to cooldown for
     */
    function _enterCooldownPeriod(address _account, uint256 _units)
        internal
        updateReward(_account)
    {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        uint88 totalUnits = oldBalance.raw + oldBalance.cooldownUnits;
        require(_units > 0 && _units <= totalUnits, "Must choose between 0 and 100%");

        // 2. Set weighted timestamp and enter cooldown
        _balances[_account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        // e.g. 1e18 / 1e16 = 100, 2e16 / 1e16 = 2, 1e15/1e16 = 0
        _balances[_account].raw = totalUnits - AuraMath.to88(_units);

        // 3. Set cooldown data
        _balances[_account].cooldownTimestamp = AuraMath.to32(block.timestamp);
        _balances[_account].cooldownUnits = AuraMath.to88(_units);

        // 4. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Exiting the cooldown period explicitly resets the users cooldown window and their balance
     * @param _account Address of user that should be exited
     */
    function _exitCooldownPeriod(address _account) internal updateReward(_account) {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);

        // 2. Set weighted timestamp and exit cooldown
        _balances[_account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        _balances[_account].raw += oldBalance.cooldownUnits;

        // 3. Set cooldown data
        _balances[_account].cooldownTimestamp = 0;
        _balances[_account].cooldownUnits = 0;

        // 4. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Pokes the weightedTimestamp of a given user and checks if it entitles them
     * to a better timeMultiplier. If not, it simply reverts as there is nothing to update.
     * @param _account Address of user that should be updated
     */
    function _reviewWeightedTimestamp(address _account) internal updateReward(_account) {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);

        // 2. Set weighted timestamp, if it changes
        uint8 newTimeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        require(newTimeMultiplier != oldBalance.timeMultiplier, "Nothing worth poking here");
        _balances[_account].timeMultiplier = newTimeMultiplier;

        // 3. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Called to mint from raw tokens. Adds raw to a users balance, and then propagates the scaledBalance.
     * Importantly, when a user stakes more, their weightedTimestamp is reduced proportionate to their stake.
     * @param _account Address of user to credit
     * @param _rawAmount Raw amount of tokens staked
     * @param _exitCooldown Should we end any cooldown?
     */
    function _mintRaw(
        address _account,
        uint256 _rawAmount,
        bool _exitCooldown
    ) internal updateReward(_account) {
        require(_account != address(0), "ERC20: mint to the zero address");

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        uint88 totalRaw = oldBalance.raw + oldBalance.cooldownUnits;
        _balances[_account].raw = oldBalance.raw + AuraMath.to88(_rawAmount);

        // 2. Exit cooldown if necessary
        if (_exitCooldown) {
            _balances[_account].raw += oldBalance.cooldownUnits;
            _balances[_account].cooldownTimestamp = 0;
            _balances[_account].cooldownUnits = 0;
        }

        // 3. Set weighted timestamp
        //  i) For new _account, set up weighted timestamp
        if (oldBalance.weightedTimestamp == 0) {
            _balances[_account].weightedTimestamp = AuraMath.to32(block.timestamp);
            _mintScaled(_account, _getBalance(_account, _balances[_account]));
            return;
        }
        //  ii) For previous minters, recalculate time held
        //      Calc new weighted timestamp
        uint256 oldWeightedSecondsHeld = (block.timestamp - oldBalance.weightedTimestamp) *
            totalRaw;
        uint256 newSecondsHeld = oldWeightedSecondsHeld / (totalRaw + (_rawAmount / 2));
        uint32 newWeightedTs = AuraMath.to32(block.timestamp - newSecondsHeld);
        _balances[_account].weightedTimestamp = newWeightedTs;

        uint8 timeMultiplier = _timeMultiplier(newWeightedTs);
        _balances[_account].timeMultiplier = timeMultiplier;

        // 3. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Called to burn a given amount of raw tokens.
     * @param _account Address of user
     * @param _rawAmount Raw amount of tokens to remove
     * @param _exitCooldown Exit the cooldown?
     * @param _finalise Has recollateralisation happened? If so, everything is cooled down
     */
    function _burnRaw(
        address _account,
        uint256 _rawAmount,
        bool _exitCooldown,
        bool _finalise
    ) internal updateReward(_account) {
        require(_account != address(0), "ERC20: burn from zero address");

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        uint256 totalRaw = oldBalance.raw + oldBalance.cooldownUnits;
        // 1.1. If _finalise, move everything to cooldown
        if (_finalise) {
            _balances[_account].raw = 0;
            _balances[_account].cooldownUnits = AuraMath.to88(totalRaw);
            oldBalance.cooldownUnits = AuraMath.to88(totalRaw);
        }
        // 1.2. Update
        require(oldBalance.cooldownUnits >= _rawAmount, "ERC20: burn amount > balance");
        unchecked {
            _balances[_account].cooldownUnits -= AuraMath.to88(_rawAmount);
        }

        // 2. If we are exiting cooldown, reset the balance
        if (_exitCooldown) {
            _balances[_account].raw += _balances[_account].cooldownUnits;
            _balances[_account].cooldownTimestamp = 0;
            _balances[_account].cooldownUnits = 0;
        }

        // 3. Set back scaled time
        // e.g. stake 10 for 100 seconds, withdraw 5.
        //      secondsHeld = (100 - 0) * (10 - 0.625) = 937.5
        uint256 secondsHeld = (block.timestamp - oldBalance.weightedTimestamp) *
            (totalRaw - (_rawAmount / 8));
        //      newWeightedTs = 937.5 / 100 = 93.75
        uint256 newSecondsHeld = secondsHeld / totalRaw;
        uint32 newWeightedTs = AuraMath.to32(block.timestamp - newSecondsHeld);
        _balances[_account].weightedTimestamp = newWeightedTs;

        uint8 timeMultiplier = _timeMultiplier(newWeightedTs);
        _balances[_account].timeMultiplier = timeMultiplier;

        // 4. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    // ---------------------------------------------------------
    // Private: updateReward should already be called by now
    // ---------------------------------------------------------

    /**
     * @dev Fetches the balance of a given user, scales it, and also takes the opportunity
     * to check if the season has just finished between now and their last action.
     * @param _account Address of user to fetch
     * @return oldBalance struct containing all balance information
     * @return oldScaledBalance scaled balance after applying multipliers
     */
    function _prepareOldBalance(address _account)
        private
        returns (Balance memory oldBalance, uint256 oldScaledBalance)
    {
        // Get the old balance
        oldBalance = _balances[_account];
        oldScaledBalance = _getBalance(_account, oldBalance);
        // Take the opportunity to check for season finish
        _balances[_account].questMultiplier = questManager.checkForSeasonFinish(_account);
    }

    /**
     * @dev Settles the scaled balance of a given account. The reason this is done here, is because
     * in each of the write functions above, there is the chance that a users balance can go down,
     * requiring to burn sacled tokens. This could happen at the end of a season when multipliers are slashed.
     * This is called after updating all multipliers etc.
     * @param _account Address of user that should be updated
     * @param _oldScaledBalance Previous scaled balance of the user
     */
    function _settleScaledBalance(address _account, uint256 _oldScaledBalance) private {
        uint256 newScaledBalance = _getBalance(_account, _balances[_account]);
        if (newScaledBalance > _oldScaledBalance) {
            _mintScaled(_account, newScaledBalance - _oldScaledBalance);
        }
        // This can happen if the user moves back a time class, but is unlikely to result in a negative mint
        else {
            _burnScaled(_account, _oldScaledBalance - newScaledBalance);
        }
    }

    /**
     * @dev Propagates the minting of the tokens downwards.
     * @param _account Address of user that has minted
     * @param _amount Amount of scaled tokens minted
     */
    function _mintScaled(address _account, uint256 _amount) private {
        emit Transfer(address(0), _account, _amount);
        _totalSupply += _amount;
    }

    /**
     * @dev Propagates the burning of the tokens downwards.
     * @param _account Address of user that has burned
     * @param _amount Amount of scaled tokens burned
     */
    function _burnScaled(address _account, uint256 _amount) private {
        emit Transfer(_account, address(0), _amount);
        _totalSupply -= _amount;
    }

    // ---------------------------------------------------------
    // Hooks
    // ---------------------------------------------------------

    /**
     * @dev Triggered after a user claims rewards from the HeadlessStakingRewards. Used
     * to check for season finish. If it has not, then do not spend gas updating the other vars.
     * @param _account Address of user that has burned
     */
    function _claimRewardHook(address _account) internal override(AuraHeadlessRewardPool) {
        uint8 newMultiplier = questManager.checkForSeasonFinish(_account);
        if (newMultiplier != _balances[_account].questMultiplier) {
            // 1. Get current balance & trigger season finish
            uint256 oldScaledBalance = _getBalance(_account, _balances[_account]);
            _balances[_account].questMultiplier = newMultiplier;
            // 3. Update scaled balance
            _settleScaledBalance(_account, oldScaledBalance);
        }
    }
}