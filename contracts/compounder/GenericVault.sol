// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IStrategy } from "../interfaces/IStrategy.sol";

/**
 * @title   GenericUnionVault
 * @author  lama.airforce -> AuraFinance
 * @notice  Changes:
 *          - remove withdraw penalty
 *          - remove platform fee
 */
contract GenericUnionVault is ERC20, Ownable {
    using SafeERC20 for IERC20;

    uint256 public callIncentive = 500;
    uint256 public constant MAX_CALL_INCENTIVE = 500;
    uint256 public constant FEE_DENOMINATOR = 10000;

    address public immutable underlying;
    address public strategy;

    event Harvest(address indexed _caller, uint256 _value);
    event Deposit(address indexed _from, address indexed _to, uint256 _value);
    event Withdraw(address indexed _from, address indexed _to, uint256 _value);
    event CallerIncentiveUpdated(uint256 _incentive);
    event StrategySet(address indexed _strategy);

    constructor(address _token)
        ERC20(
            string(abi.encodePacked("Unionized ", ERC20(_token).name())),
            string(abi.encodePacked("u", ERC20(_token).symbol()))
        )
    {
        underlying = _token;
    }

    /// @notice Updates the caller incentive for harvests
    /// @param _incentive - the amount of the new incentive (in BIPS)
    function setCallIncentive(uint256 _incentive) external onlyOwner {
        require(_incentive <= MAX_CALL_INCENTIVE);
        callIncentive = _incentive;
        emit CallerIncentiveUpdated(_incentive);
    }

    /// @notice Set the address of the strategy contract
    /// @dev Can only be set once
    /// @param _strategy - address of the strategy contract
    function setStrategy(address _strategy) external onlyOwner notToZeroAddress(_strategy) {
        require(strategy == address(0), "Strategy already set");
        strategy = _strategy;
        emit StrategySet(_strategy);
    }

    /// @notice Query the amount currently staked
    /// @return total - the total amount of tokens staked
    function totalUnderlying() public view returns (uint256 total) {
        return IStrategy(strategy).totalUnderlying();
    }

    /// @notice Returns the amount of underlying a user can claim
    /// @param user - address whose claimable amount to query
    /// @return amount - claimable amount
    /// @dev Does not account for penalties and fees
    function balanceOfUnderlying(address user) external view returns (uint256 amount) {
        require(totalSupply() > 0, "No users");
        return ((balanceOf(user) * totalUnderlying()) / totalSupply());
    }

    /// @notice Deposit user funds in the autocompounder and mints tokens
    /// representing user's share of the pool in exchange
    /// @param _to - the address that will receive the shares
    /// @param _amount - the amount of underlying to deposit
    /// @return _shares - the amount of shares issued
    function deposit(address _to, uint256 _amount) public notToZeroAddress(_to) returns (uint256 _shares) {
        require(_amount > 0, "Deposit too small");

        uint256 _before = totalUnderlying();
        IERC20(underlying).safeTransferFrom(msg.sender, strategy, _amount);
        IStrategy(strategy).stake(_amount);

        // Issues shares in proportion of deposit to pool amount
        uint256 shares = 0;
        if (totalSupply() == 0) {
            shares = _amount;
        } else {
            shares = (_amount * totalSupply()) / _before;
        }
        _mint(_to, shares);
        emit Deposit(msg.sender, _to, _amount);
        return shares;
    }

    /// @notice Deposit all of user's underlying balance
    /// @param _to - the address that will receive the shares
    /// @return _shares - the amount of shares issued
    function depositAll(address _to) external returns (uint256 _shares) {
        return deposit(_to, IERC20(underlying).balanceOf(msg.sender));
    }

    /// @notice Unstake underlying in proportion to the amount of shares sent
    /// @param _shares - the number of shares sent
    /// @return _withdrawable - the withdrawable underlying amount
    function _withdraw(uint256 _shares) internal returns (uint256 _withdrawable) {
        require(totalSupply() > 0);
        // Computes the amount withdrawable based on the number of shares sent
        uint256 amount = (_shares * totalUnderlying()) / totalSupply();
        // Burn the shares before retrieving tokens
        _burn(msg.sender, _shares);
        // If user is last to withdraw, harvest before exit
        if (totalSupply() == 0) {
            harvest();
            IStrategy(strategy).withdraw(totalUnderlying());
            _withdrawable = IERC20(underlying).balanceOf(address(this));
        }
        // Otherwise compute share and unstake
        else {
            _withdrawable = amount;
            // Substract a small withdrawal fee to prevent users "timing"
            // the harvests. The fee stays staked and is therefore
            // redistributed to all remaining participants.
            IStrategy(strategy).withdraw(_withdrawable);
        }
        return _withdrawable;
    }

    /// @notice Unstake underlying token in proportion to the amount of shares sent
    /// @param _to - address to send underlying to
    /// @param _shares - the number of shares sent
    /// @return withdrawn - the amount of underlying returned to the user
    function withdraw(address _to, uint256 _shares) public notToZeroAddress(_to) returns (uint256 withdrawn) {
        // Withdraw requested amount of underlying
        uint256 _withdrawable = _withdraw(_shares);
        // And sends back underlying to user
        IERC20(underlying).safeTransfer(_to, _withdrawable);
        emit Withdraw(msg.sender, _to, _withdrawable);
        return _withdrawable;
    }

    /// @notice Withdraw all of a users' position as underlying
    /// @param _to - address to send underlying to
    /// @return withdrawn - the amount of underlying returned to the user
    function withdrawAll(address _to) external notToZeroAddress(_to) returns (uint256 withdrawn) {
        return withdraw(_to, balanceOf(msg.sender));
    }

    /// @notice Claim rewards and swaps them to FXS for restaking
    /// @dev Can be called by anyone against an incentive in FXS
    /// @dev Harvest logic in the strategy contract
    function harvest() public virtual {
        uint256 _harvested = IStrategy(strategy).harvest(msg.sender);
        emit Harvest(msg.sender, _harvested);
    }

    modifier notToZeroAddress(address _to) {
        require(_to != address(0), "Invalid address!");
        _;
    }
}
