// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { AuraMath } from "../utils/AuraMath.sol";
import { IAuraLocker } from "../interfaces/IAuraLocker.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

interface IVestedEscrow {
    function claim(bool) external;

    function rewardToken() external view returns (address);

    function totalClaimed(address) external view returns (uint256);
}

/**
 * @title   VestingRecipient
 * @author  AuraFinance
 */
contract VestingRecipient {
    using AuraMath for uint256;
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------
    // Storage
    // ----------------------------------------------------------

    uint256 public unlockTime;

    uint256 public constant UNLOCK_DURATION = 365 days * 3;

    address public owner;

    address public immutable vesting;

    address public immutable auraLocker;

    address public immutable rewardToken;

    mapping(address => uint256) public claimed;

    // ----------------------------------------------------------
    // Events
    // ----------------------------------------------------------

    event SetOwner(address _owner);

    // ----------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------

    /**
     * @param _owner The address of the owner
     * @param _vesting VestedEscrow V2 contract
     * @param _auraLocker Aura Locker contract
     */
    constructor(
        address _owner,
        address _vesting,
        address _auraLocker
    ) {
        // TODO: create init function to setup owner so this can be proxied
        owner = _owner;
        vesting = _vesting;
        auraLocker = _auraLocker;

        rewardToken = IVestedEscrow(_vesting).rewardToken();
        unlockTime = block.timestamp + UNLOCK_DURATION;
    }

    // ----------------------------------------------------------
    // View
    // ----------------------------------------------------------

    /**
     * @dev Returns the withdrawable amount of the reward token
     */
    function withdrawable() external view returns (uint256) {
        return _withdrawable();
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
     */
    function claim(bool _lock) external {
        require(msg.sender == owner, "!owner");
        IVestedEscrow(vesting).claim(_lock);
    }

    /**
     * @dev Withdraw ERC20 tokens
     *      If the unlock time has not expired for AURA then limit the
     *      amount that can be withdraw to the withdrawable amount
     * @param _token The ERC20 token
     * @param _amount The amount of tokens to withdraw
     */
    function withdrawERC20(address _token, uint256 _amount) external {
        require(msg.sender == owner, "!owner");
        if (rewardToken == _token && block.timestamp < unlockTime) {
            require(unlockTime != 0, "!unlockTime");
            require(_amount <= _withdrawable(), "amount>withdrawable");
        }

        claimed[_token] += _amount;
        IERC20(_token).transfer(msg.sender, _amount);
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
     */
    function processExpiredLocks() external {
        require(msg.sender == owner, "!owner");
        IAuraLocker(auraLocker).processExpiredLocks(true);
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

    function _lock(uint256 _amount) internal {
        require(address(auraLocker) != address(0), "!auraLocker");
        IERC20(rewardToken).safeApprove(address(auraLocker), _amount);
        IAuraLocker(auraLocker).lock(address(this), _amount);
    }

    function _withdrawable() internal view returns (uint256) {
        uint256 totalVestClaimed = IVestedEscrow(vesting).totalClaimed(address(this));
        return totalVestClaimed.div(2).sub(claimed[rewardToken]);
    }
}
