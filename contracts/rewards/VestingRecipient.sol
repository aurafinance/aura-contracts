// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-0.8/proxy/utils/Initializable.sol";

interface IVestedEscrow {
    function claim(bool) external;

    function rewardToken() external view returns (address);

    function totalClaimed(address) external view returns (uint256);
}

/**
 * @title   VestingRecipient
 * @author  AuraFinance
 */
contract VestingRecipient is Initializable {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;
    /// @notice The unlock duration period.
    uint256 public constant UNLOCK_DURATION = 365 days * 3;

    // ----------------------------------------------------------
    // Storage
    // ----------------------------------------------------------

    /// @notice The unlock time when tokens can be withdrawn.
    uint256 public unlockTime;
    /// @notice The owner of the contract.
    address public owner;
    /// @notice The VestedEscrow V2 contract
    address public immutable vesting;
    /// @notice The Aura Locker contract, it implements IAuraLocker
    address public immutable auraLocker;
    /// @notice ERC20 Token
    address public immutable rewardToken;
    /// @notice (tokenAddress, amountClaimend) map.
    mapping(address => uint256) public claimed;

    // ----------------------------------------------------------
    // Events
    // ----------------------------------------------------------
    /// @dev Event emmited when the owner of the contract is set.
    /// @param _owner The onwer of the contract
    event SetOwner(address _owner);

    // ----------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------

    /**
     * @param _vesting VestedEscrow V2 contract
     * @param _auraLocker Aura Locker contract
     */
    constructor(address _vesting, address _auraLocker) {
        vesting = _vesting;
        auraLocker = _auraLocker;
        rewardToken = IVestedEscrow(_vesting).rewardToken();
    }

    /**
     * @dev Initialize the contract, owner and unlockTime.
     * @param _owner The address of the owner
     */
    function init(address _owner) external initializer {
        owner = _owner;
        unlockTime = block.timestamp + UNLOCK_DURATION;
    }

    // ----------------------------------------------------------
    // View
    // ----------------------------------------------------------

    /**
     * @notice The max withdrawable amount only depends on the unlock time and claimed rewards. 
     * It does not take into account if the reward tokens are locked or rewards had been already witdhrawn.
     * if the unlock time has not expired only half of the claimed rewards can be witdhrawn, 
     * If the unlock time has expired then the full claimed amount can be withdraw. 
     * @dev Returns the maxWithdrawable amount of the reward token.

     */
    function maxWithdrawable() external view returns (uint256) {
        return _maxWithdrawable();
    }

    // ----------------------------------------------------------
    // Setters
    // ----------------------------------------------------------

    /**
     * @dev Set the owner of this contract
     * @param _owner New owner address
     */
    function setOwner(address _owner) external {
        require(msg.sender == owner, "!owner");
        owner = _owner;
        emit SetOwner(_owner);
    }

    // ----------------------------------------------------------
    // Core
    // ----------------------------------------------------------

    /**
     * @dev Claim tokens from vesting contract
     * @param _lock       Lock rewards immediately.
     */
    function claim(bool _lock) external {
        require(msg.sender == owner, "!owner");
        IVestedEscrow(vesting).claim(_lock);
    }

    /**
     * @dev Withdraw ERC20 tokens
     *      If the unlock time has not expired for AURA then limit the
     *      amount that can be withdraw to the maxWithdrawable amount
     * @param _token The ERC20 token
     * @param _amount The amount of tokens to withdraw
     */
    function withdrawERC20(address _token, uint256 _amount) external {
        require(msg.sender == owner, "!owner");
        if (rewardToken == _token && block.timestamp < unlockTime) {
            require(unlockTime != 0, "!unlockTime");
            require(_amount <= _maxWithdrawable(), "amount>maxWithdrawable");
        }

        claimed[_token] += _amount;
        IERC20(_token).safeTransfer(msg.sender, _amount);
    }

    // ----------------------------------------------------------
    // Aura Locker
    // ----------------------------------------------------------

    /**
     * @dev Lock AURA
     * @param _amount Amount of AURA to lock
     */
    function lock(uint256 _amount) external {
        require(msg.sender == owner, "!owner");
        _lock(_amount);
    }

    /**
     * @dev Wrapper for AuraLocker processExpiredLocks
     * It withdraws/relocks all currently locked tokens where the unlock time has passed.
     */
    function processExpiredLocks(bool _relock) external {
        require(msg.sender == owner, "!owner");
        // relock or withdraw
        IAuraLocker(auraLocker).processExpiredLocks(_relock);
    }

    /**
     * @dev Delegate vlAURA votes to another address
     * @param _to Address to delegate to
     */
    function delegate(address _to) external {
        require(msg.sender == owner, "!owner");
        IAuraLocker(auraLocker).delegate(_to);
    }

    // ----------------------------------------------------------
    // Execute
    // ----------------------------------------------------------

    /**
     * @dev Execute arbitrary function call
     * @param _to     Address to execute call on
     *                This address cannot be the AuraLocker or AuraToken
     * @param _value  Value to send
     * @param _data   Data to send
     */
    function execute(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) external payable returns (bool, bytes memory) {
        require(msg.sender == owner, "!owner");
        require(_to != rewardToken, "to==rewardToken");
        require(_to != auraLocker, "to==auraLocker");

        (bool success, bytes memory result) = _to.call{ value: _value }(_data);
        require(success, "!success");

        return (success, result);
    }

    // ----------------------------------------------------------
    // Internal
    // ----------------------------------------------------------

    /**
     * @dev Locks reward tokens on the aura locker.
     * @param _amount Amount of reward tokens to  lock.
     */
    function _lock(uint256 _amount) internal {
        IERC20(rewardToken).safeApprove(address(auraLocker), _amount);
        IAuraLocker(auraLocker).lock(address(this), _amount);
    }

    /**
     * @dev Upbound Amount reward tokens to withdraw.
     */
    function _maxWithdrawable() internal view returns (uint256) {
        uint256 totalVestClaimed = IVestedEscrow(vesting).totalClaimed(address(this));
        if (block.timestamp >= unlockTime) {
            return totalVestClaimed.sub(claimed[rewardToken]);
        }
        return totalVestClaimed.div(2).sub(claimed[rewardToken]);
    }
}
